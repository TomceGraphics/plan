//! Google Calendar plumbing (opt-in).
//!
//! * OAuth 2.0 for installed apps with PKCE and a loopback redirect (RFC 8252). The user brings
//!   their own OAuth client (or the build embeds one via `PLAN_GOOGLE_CLIENT_ID/SECRET`).
//! * Tokens live in `<app config dir>/google-token.json` (mode 0600) and never reach the webview.
//! * `google_request` is a narrow proxy to the Calendar v3 API: it adds the bearer token,
//!   refreshes it when needed, and refuses any path outside `/calendar/v3/`.
//!
//! Sync logic itself lives in the frontend (`src/lib/sync.ts`).

use std::collections::HashMap;
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{Mutex, Notify};

const SCOPE: &str = "https://www.googleapis.com/auth/calendar";
const BUILTIN_ID: Option<&str> = option_env!("PLAN_GOOGLE_CLIENT_ID");
const BUILTIN_SECRET: Option<&str> = option_env!("PLAN_GOOGLE_CLIENT_SECRET");

#[derive(Clone)]
pub struct Endpoints {
    pub auth: String,
    pub token: String,
    pub revoke: String,
    pub api: String,
}

impl Default for Endpoints {
    fn default() -> Self {
        Self {
            auth: "https://accounts.google.com/o/oauth2/v2/auth".into(),
            token: "https://oauth2.googleapis.com/token".into(),
            revoke: "https://oauth2.googleapis.com/revoke".into(),
            api: "https://www.googleapis.com".into(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Tokens {
    client_id: String,
    client_secret: String,
    refresh_token: String,
    access_token: String,
    expires_at: i64,
}

pub struct GoogleState {
    http: reqwest::Client,
    ep: Endpoints,
    lock: Mutex<()>,
    cancel: Notify,
}

impl Default for GoogleState {
    fn default() -> Self {
        Self::with_endpoints(Endpoints::default())
    }
}

impl GoogleState {
    pub fn with_endpoints(ep: Endpoints) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent(concat!("Plan/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("http client");
        Self { http, ep, lock: Mutex::new(()), cancel: Notify::new() }
    }
}

// ───────────────────────── token storage

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn token_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("google-token.json"))
}

fn load_tokens(path: &Path) -> Option<Tokens> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

fn save_tokens(path: &Path, t: &Tokens) -> Result<(), String> {
    let json = serde_json::to_vec(t).map_err(|e| e.to_string())?;
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
        .map_err(|e| e.to_string())?;
    f.write_all(&json).map_err(|e| e.to_string())
}

// ───────────────────────── OAuth

#[derive(Deserialize)]
struct TokenResp {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
}

fn random_string(n: usize) -> String {
    rand::thread_rng().sample_iter(&Alphanumeric).take(n).map(char::from).collect()
}

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Plan</title><body style=\"font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#f7f7f9;color:#1b1d24\"><div style=\"text-align:center\"><h1 style=\"font-size:20px\">Plan is connected to Google Calendar</h1><p>You can close this tab and return to Plan.</p></div>";

async fn respond(sock: &mut tokio::net::TcpStream, status: &str, body: &str) {
    let msg = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = sock.write_all(msg.as_bytes()).await;
    let _ = sock.shutdown().await;
}

/// Accepts loopback connections until one carries `?code=…&state=…` (or an OAuth error).
async fn wait_for_code(listener: &TcpListener, state: &str) -> Result<String, String> {
    loop {
        let (mut sock, _) = listener.accept().await.map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; 8192];
        // browsers sometimes open speculative connections that never send anything
        let n = match tokio::time::timeout(Duration::from_secs(3), sock.read(&mut buf)).await {
            Ok(Ok(n)) if n > 0 => n,
            _ => continue,
        };
        let req = String::from_utf8_lossy(&buf[..n]);
        let path = req.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("/");
        let url = match reqwest::Url::parse(&format!("http://127.0.0.1{path}")) {
            Ok(u) => u,
            Err(_) => {
                respond(&mut sock, "400 Bad Request", "bad request").await;
                continue;
            }
        };
        let q: HashMap<String, String> = url.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
        if let Some(err) = q.get("error") {
            respond(&mut sock, "400 Bad Request", "Authorisation was denied. You can close this tab.").await;
            return Err(format!("Google sign-in failed: {err}"));
        }
        match (q.get("code"), q.get("state")) {
            (Some(code), Some(s)) if s == state => {
                respond(&mut sock, "200 OK", DONE_PAGE).await;
                return Ok(code.clone());
            }
            _ => respond(&mut sock, "404 Not Found", "not found").await,
        }
    }
}

async fn token_error(resp: reqwest::Response) -> String {
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if body.contains("invalid_grant") {
        return "auth_expired".into();
    }
    format!("Google token endpoint returned {status}: {body}")
}

pub async fn sign_in<F: FnOnce(&str)>(
    http: &reqwest::Client,
    ep: &Endpoints,
    client_id: &str,
    client_secret: &str,
    cancel: &Notify,
    announce: F,
) -> Result<Tokens, String> {
    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://127.0.0.1:{port}");
    let verifier = random_string(64);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_string(24);

    let mut url = reqwest::Url::parse(&ep.auth).map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", &redirect)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPE)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("state", &state);
    announce(url.as_str());

    let code = tokio::select! {
        r = wait_for_code(&listener, &state) => r?,
        _ = cancel.notified() => return Err("cancelled".into()),
        _ = tokio::time::sleep(Duration::from_secs(300)) => return Err("Timed out waiting for the browser sign-in.".into()),
    };

    let resp = http
        .post(&ep.token)
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("code", code.as_str()),
            ("code_verifier", verifier.as_str()),
            ("redirect_uri", redirect.as_str()),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(token_error(resp).await);
    }
    let t: TokenResp = resp.json().await.map_err(|e| e.to_string())?;
    let refresh = t
        .refresh_token
        .ok_or("Google did not return a refresh token. Remove Plan under myaccount.google.com/permissions and connect again.")?;
    Ok(Tokens {
        client_id: client_id.into(),
        client_secret: client_secret.into(),
        refresh_token: refresh,
        access_token: t.access_token,
        expires_at: now_secs() + t.expires_in.unwrap_or(3600),
    })
}

async fn refresh(http: &reqwest::Client, ep: &Endpoints, t: &mut Tokens) -> Result<(), String> {
    let resp = http
        .post(&ep.token)
        .form(&[
            ("client_id", t.client_id.as_str()),
            ("client_secret", t.client_secret.as_str()),
            ("refresh_token", t.refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(token_error(resp).await);
    }
    let r: TokenResp = resp.json().await.map_err(|e| e.to_string())?;
    t.access_token = r.access_token;
    t.expires_at = now_secs() + r.expires_in.unwrap_or(3600);
    Ok(())
}

/// Returns a valid access token, refreshing (and persisting) when it is about to expire.
async fn access_token(path: &Path, http: &reqwest::Client, ep: &Endpoints, force: bool) -> Result<String, String> {
    let mut t = load_tokens(path).ok_or("not_connected")?;
    if force || t.expires_at - 60 < now_secs() {
        if let Err(e) = refresh(http, ep, &mut t).await {
            if e == "auth_expired" {
                let _ = std::fs::remove_file(path);
            }
            return Err(e);
        }
        save_tokens(path, &t)?;
    }
    Ok(t.access_token)
}

// ───────────────────────── request proxy

#[derive(Serialize, Debug)]
pub struct Resp {
    pub status: u16,
    pub body: String,
}

fn valid_path(p: &str) -> bool {
    p.starts_with("/calendar/v3/") && !p.contains("..") && !p.contains("://") && !p.contains('?') && !p.contains('#')
}

pub async fn proxy(
    path: &Path,
    http: &reqwest::Client,
    ep: &Endpoints,
    method: &str,
    api_path: &str,
    query: Option<HashMap<String, String>>,
    body: Option<String>,
) -> Result<Resp, String> {
    if !valid_path(api_path) {
        return Err("request path not allowed".into());
    }
    let m = match method {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PATCH" => reqwest::Method::PATCH,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        _ => return Err("method not allowed".into()),
    };
    let url = format!("{}{}", ep.api, api_path);
    let q: Vec<(String, String)> = query.unwrap_or_default().into_iter().collect();
    for attempt in 0..2 {
        let token = access_token(path, http, ep, attempt == 1).await?;
        let mut req = http.request(m.clone(), &url).bearer_auth(token).query(&q);
        if let Some(b) = &body {
            req = req.header("Content-Type", "application/json").body(b.clone());
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;
        if resp.status().as_u16() == 401 && attempt == 0 {
            continue;
        }
        let status = resp.status().as_u16();
        let body = resp.text().await.map_err(|e| e.to_string())?;
        return Ok(Resp { status, body });
    }
    Err("auth_expired".into())
}

// ───────────────────────── commands

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    connected: bool,
    builtin_client: bool,
}

#[tauri::command]
pub fn google_status(app: AppHandle) -> Status {
    let connected = token_path(&app).ok().and_then(|p| load_tokens(&p)).is_some();
    Status { connected, builtin_client: BUILTIN_ID.is_some() && BUILTIN_SECRET.is_some() }
}

#[tauri::command]
pub async fn google_sign_in(
    app: AppHandle,
    state: State<'_, GoogleState>,
    client_id: Option<String>,
    client_secret: Option<String>,
) -> Result<(), String> {
    let id = client_id.filter(|s| !s.trim().is_empty()).or(BUILTIN_ID.map(String::from));
    let secret = client_secret.filter(|s| !s.trim().is_empty()).or(BUILTIN_SECRET.map(String::from));
    let (id, secret) = match (id, secret) {
        (Some(i), Some(s)) => (i.trim().to_string(), s.trim().to_string()),
        _ => return Err("Enter the OAuth client ID and client secret first.".into()),
    };
    let handle = app.clone();
    let tokens = sign_in(&state.http, &state.ep, &id, &secret, &state.cancel, move |url| {
        let _ = handle.emit("google-auth-url", url.to_string());
        let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    })
    .await?;
    let _g = state.lock.lock().await;
    save_tokens(&token_path(&app)?, &tokens)
}

#[tauri::command]
pub fn google_cancel(state: State<'_, GoogleState>) {
    state.cancel.notify_one();
}

#[tauri::command]
pub async fn google_sign_out(app: AppHandle, state: State<'_, GoogleState>) -> Result<(), String> {
    let path = token_path(&app)?;
    let _g = state.lock.lock().await;
    if let Some(t) = load_tokens(&path) {
        // best effort: invalidate the grant on Google's side
        let _ = state.http.post(&state.ep.revoke).form(&[("token", t.refresh_token.as_str())]).send().await;
    }
    let _ = std::fs::remove_file(&path);
    Ok(())
}

#[tauri::command]
pub async fn google_request(
    app: AppHandle,
    state: State<'_, GoogleState>,
    method: String,
    path: String,
    query: Option<HashMap<String, String>>,
    body: Option<String>,
) -> Result<Resp, String> {
    let file = token_path(&app)?;
    let _g = state.lock.lock().await; // serialises token refreshes; requests are quick
    proxy(&file, &state.http, &state.ep, &method, &path, query, body).await
}

// ───────────────────────── tests (mock Google on localhost, no network)

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex as StdMutex};

    /// Minimal HTTP server: POST /token, POST /revoke, GET /calendar/v3/ping.
    async fn mock(log: Arc<StdMutex<Vec<String>>>) -> u16 {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let (mut s, _) = l.accept().await.unwrap();
                let log = log.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 16384];
                    let n = s.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]).to_string();
                    let first = req.lines().next().unwrap_or("").to_string();
                    log.lock().unwrap().push(req.clone());
                    let (status, body) = if first.starts_with("POST /token") {
                        if req.contains("refresh_token=revoked") {
                            ("400 Bad Request", r#"{"error":"invalid_grant"}"#)
                        } else if req.contains("grant_type=refresh_token") {
                            ("200 OK", r#"{"access_token":"at2","expires_in":3600}"#)
                        } else if req.contains("code=thecode") && req.contains("code_verifier=") {
                            ("200 OK", r#"{"access_token":"at1","refresh_token":"rt1","expires_in":3600}"#)
                        } else {
                            ("400 Bad Request", r#"{"error":"invalid_grant"}"#)
                        }
                    } else if first.starts_with("GET /calendar/v3/ping") {
                        if req.contains("authorization: Bearer at2") || req.contains("Authorization: Bearer at2") {
                            ("200 OK", r#"{"ok":true}"#)
                        } else {
                            ("401 Unauthorized", r#"{"error":"unauth"}"#)
                        }
                    } else {
                        ("200 OK", "{}")
                    };
                    let msg = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                    let _ = s.write_all(msg.as_bytes()).await;
                    let _ = s.shutdown().await;
                });
            }
        });
        port
    }

    fn eps(port: u16) -> Endpoints {
        let b = format!("http://127.0.0.1:{port}");
        Endpoints { auth: format!("{b}/auth"), token: format!("{b}/token"), revoke: format!("{b}/revoke"), api: b }
    }

    #[tokio::test]
    async fn full_flow_sign_in_refresh_and_proxy() {
        let log = Arc::new(StdMutex::new(vec![]));
        let port = mock(log.clone()).await;
        let ep = eps(port);
        let st = GoogleState::with_endpoints(ep.clone());

        // "browser": follow the auth URL by hitting the loopback redirect with a code
        let tokens = sign_in(&st.http, &ep, "cid", "csecret", &st.cancel, |url| {
            let u = reqwest::Url::parse(url).unwrap();
            let q: HashMap<_, _> = u.query_pairs().into_owned().collect();
            assert_eq!(q["client_id"], "cid");
            assert_eq!(q["code_challenge_method"], "S256");
            assert_eq!(q["access_type"], "offline");
            assert!(q["scope"].contains("auth/calendar"));
            let redirect = q["redirect_uri"].clone();
            let state = q["state"].clone();
            tokio::spawn(async move {
                // a wrong state must be ignored…
                let _ = reqwest::get(format!("{redirect}/?code=evil&state=nope")).await;
                // …and the right one accepted
                let r = reqwest::get(format!("{redirect}/?code=thecode&state={state}")).await.unwrap();
                assert!(r.text().await.unwrap().contains("connected"));
            });
        })
        .await
        .unwrap();
        assert_eq!(tokens.refresh_token, "rt1");
        assert_eq!(tokens.access_token, "at1");

        // store with an already-expired access token → proxy must refresh before calling the API
        let dir = std::env::temp_dir().join(format!("plan-test-{}", random_string(8)));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("google-token.json");
        let mut expired = tokens.clone();
        expired.expires_at = 0;
        save_tokens(&file, &expired).unwrap();
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);

        let r = proxy(&file, &st.http, &ep, "GET", "/calendar/v3/ping", None, None).await.unwrap();
        assert_eq!(r.status, 200);
        assert_eq!(load_tokens(&file).unwrap().access_token, "at2", "refreshed token is persisted");

        // path / method allow-list
        assert!(proxy(&file, &st.http, &ep, "GET", "/oauth2/v2/userinfo", None, None).await.is_err());
        assert!(proxy(&file, &st.http, &ep, "GET", "/calendar/v3/../x", None, None).await.is_err());
        assert!(proxy(&file, &st.http, &ep, "TRACE", "/calendar/v3/ping", None, None).await.is_err());

        // revoked grant → clear "auth_expired" error and the token file is removed
        let mut bad = load_tokens(&file).unwrap();
        bad.refresh_token = "revoked".into();
        bad.expires_at = 0;
        save_tokens(&file, &bad).unwrap();
        let err = proxy(&file, &st.http, &ep, "GET", "/calendar/v3/ping", None, None).await.unwrap_err();
        assert_eq!(err, "auth_expired");
        assert!(!file.exists(), "dead credentials are deleted");
        let err = proxy(&file, &st.http, &ep, "GET", "/calendar/v3/ping", None, None).await.unwrap_err();
        assert_eq!(err, "not_connected");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[tokio::test]
    async fn sign_in_can_be_cancelled_and_reports_denial() {
        let log = Arc::new(StdMutex::new(vec![]));
        let port = mock(log).await;
        let ep = eps(port);
        let st = GoogleState::with_endpoints(ep.clone());
        let cancel = Notify::new();
        cancel.notify_one();
        let err = sign_in(&st.http, &ep, "c", "s", &cancel, |_| {}).await.unwrap_err();
        assert_eq!(err, "cancelled");

        let err = sign_in(&st.http, &ep, "c", "s", &st.cancel, |url| {
            let u = reqwest::Url::parse(url).unwrap();
            let q: HashMap<_, _> = u.query_pairs().into_owned().collect();
            let redirect = q["redirect_uri"].clone();
            tokio::spawn(async move {
                let _ = reqwest::get(format!("{redirect}/?error=access_denied")).await;
            });
        })
        .await
        .unwrap_err();
        assert!(err.contains("access_denied"));
    }

    #[test]
    fn path_validation() {
        assert!(valid_path("/calendar/v3/calendars/a%40b.com/events"));
        assert!(!valid_path("/calendar/v3/x?y=1"));
        assert!(!valid_path("https://evil/calendar/v3/"));
        assert!(!valid_path("/drive/v3/files"));
    }
}
