const CLIENT_ID = "yH0aTnJEt6qUgGn835B4vg";

const REDIRECT_URI =
    "https://carpatintinoficial-bot.github.io/goonitupnowz.github.io/";

const OAUTH_URL =
    "https://www.reddit.com/api/v1/authorize";

const API_URL =
    "https://oauth.reddit.com";

const TOKEN_STORAGE_KEY =
    "reddit_access_token";

const STATE_STORAGE_KEY =
    "reddit_oauth_state";

let redditAccessToken = null;


/*
 * ------------------------------------------------------------
 * OAuth helpers
 * ------------------------------------------------------------
 */

function generateState() {
    const bytes = new Uint8Array(24);

    crypto.getRandomValues(bytes);

    return Array.from(bytes)
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
}


function buildAuthorizationUrl() {
    const state = generateState();

    sessionStorage.setItem(
        STATE_STORAGE_KEY,
        state
    );

    const params = new URLSearchParams();

    params.set("client_id", CLIENT_ID);
    params.set("response_type", "token");
    params.set("state", state);
    params.set("redirect_uri", REDIRECT_URI);
    params.set("duration", "temporary");
    params.set("scope", "read");

    return `${OAUTH_URL}?${params.toString()}`;
}


function loginWithReddit() {
    const authorizationUrl =
        buildAuthorizationUrl();

    window.location.assign(
        authorizationUrl
    );
}


/*
 * ------------------------------------------------------------
 * OAuth callback
 * ------------------------------------------------------------
 */

function handleOAuthCallback() {
    const hash =
        window.location.hash;

    if (!hash) {
        return false;
    }

    const fragment =
        new URLSearchParams(
            hash.substring(1)
        );

    const accessToken =
        fragment.get("access_token");

    /*
     * No access_token means this isn't our
     * OAuth callback.
     */
    if (!accessToken) {
        return false;
    }

    const returnedState =
        fragment.get("state");

    const expectedState =
        sessionStorage.getItem(
            STATE_STORAGE_KEY
        );

    /*
     * Verify the OAuth state to prevent
     * accepting a token from an unrelated
     * authorization request.
     */
    if (
        !returnedState ||
        !expectedState ||
        returnedState !== expectedState
    ) {
        console.error(
            "Reddit OAuth state validation failed."
        );

        return false;
    }

    redditAccessToken =
        accessToken;

    sessionStorage.setItem(
        TOKEN_STORAGE_KEY,
        accessToken
    );

    sessionStorage.removeItem(
        STATE_STORAGE_KEY
    );

    /*
     * Remove the OAuth fragment from the
     * address bar. The token therefore won't
     * remain visible in the URL after login.
     */
    window.history.replaceState(
        {},
        document.title,
        window.location.pathname +
        window.location.search
    );

    updateAuthUI();

    return true;
}


/*
 * ------------------------------------------------------------
 * Stored authentication
 * ------------------------------------------------------------
 */

function loadStoredToken() {
    redditAccessToken =
        sessionStorage.getItem(
            TOKEN_STORAGE_KEY
        );

    updateAuthUI();
}


function clearRedditToken() {
    redditAccessToken = null;

    sessionStorage.removeItem(
        TOKEN_STORAGE_KEY
    );

    updateAuthUI();
}


/*
 * ------------------------------------------------------------
 * Authentication UI
 * ------------------------------------------------------------
 */

function updateAuthUI() {
    const loginButton =
        document.getElementById(
            "redditLogin"
        );

    const authStatus =
        document.getElementById(
            "redditAuthStatus"
        );

    if (redditAccessToken) {
        if (loginButton) {
            loginButton.textContent =
                "Re-login with Reddit";
        }

        if (authStatus) {
            authStatus.textContent =
                "Logged in to Reddit";
        }
    } else {
        if (loginButton) {
            loginButton.textContent =
                "Login with Reddit";
        }

        if (authStatus) {
            authStatus.textContent =
                "Not logged in";
        }
    }
}


/*
 * ------------------------------------------------------------
 * Reddit API
 * ------------------------------------------------------------
 */

export async function redditFetch(
    endpoint,
    options = {}
) {
    if (!redditAccessToken) {
        throw new Error(
            "Reddit is not authenticated. " +
            "Click 'Login with Reddit' first."
        );
    }

    let url;

    if (
        endpoint.startsWith("http://") ||
        endpoint.startsWith("https://")
    ) {
        url = endpoint;
    } else {
        url =
            API_URL +
            (
                endpoint.startsWith("/")
                    ? endpoint
                    : `/${endpoint}`
            );
    }

    const headers =
        new Headers(
            options.headers || {}
        );

    /*
     * Reddit OAuth authentication.
     */
    headers.set(
        "Authorization",
        `Bearer ${redditAccessToken}`
    );

    /*
     * Browser JavaScript cannot reliably set
     * the User-Agent header. Do not attempt to
     * set it here.
     */

    headers.set(
        "Accept",
        "application/json"
    );

    const response =
        await fetch(url, {
            ...options,
            headers
        });

    /*
     * The temporary token normally expires
     * after approximately one hour.
     */
    if (
        response.status === 401 ||
        response.status === 403
    ) {
        let body = "";

        try {
            body =
                await response.text();
        } catch (_) {
            // Ignore response parsing failure.
        }

        /*
         * Only automatically log the user out
         * for an authentication failure.
         */
        if (response.status === 401) {
            clearRedditToken();
        }

        throw new Error(
            `Reddit API returned ${response.status}` +
            (body ? `: ${body}` : "")
        );
    }

    if (!response.ok) {
        let body = "";

        try {
            body =
                await response.text();
        } catch (_) {
            // Ignore response parsing failure.
        }

        throw new Error(
            `Reddit API returned ${response.status}` +
            (body ? `: ${body}` : "")
        );
    }

    return response;
}


export async function redditJson(
    endpoint,
    options = {}
) {
    const response =
        await redditFetch(
            endpoint,
            options
        );

    return response.json();
}


/*
 * ------------------------------------------------------------
 * Convenience Reddit listing function
 * ------------------------------------------------------------
 */

export async function getSubredditPosts(
    subreddit,
    sort = "hot",
    time = "day",
    limit = 100
) {
    if (!subreddit) {
        throw new Error(
            "No subreddit was specified."
        );
    }

    /*
     * Remove a leading r/ if the user entered
     * one, and remove surrounding whitespace.
     */
    subreddit =
        subreddit
            .trim()
            .replace(/^\/?r\//i, "");

    let endpoint =
        `/r/${encodeURIComponent(
            subreddit
        )}/${encodeURIComponent(
            sort
        )}.json?limit=${encodeURIComponent(
            limit
        )}`;

    /*
     * Reddit's time parameter is relevant
     * to top/controversial listings.
     */
    if (
        sort === "top" ||
        sort === "controversial"
    ) {
        endpoint +=
            `&t=${encodeURIComponent(time)}`;
    }

    return redditJson(
        endpoint
    );
}


/*
 * ------------------------------------------------------------
 * Existing-style startReddit entry point
 * ------------------------------------------------------------
 */

export async function startReddit() {
    if (!redditAccessToken) {
        loginWithReddit();
        return;
    }

    /*
     * This function intentionally does not
     * duplicate the application's slideshow
     * implementation.
     *
     * Your existing slideshow code can call
     * getSubredditPosts() to obtain Reddit
     * listings.
     */

    console.log(
        "Reddit authentication is active."
    );
}


/*
 * ------------------------------------------------------------
 * Initialization
 * ------------------------------------------------------------
 */

export function initReddit() {
    /*
     * First check whether Reddit just redirected
     * us back from OAuth.
     */
    handleOAuthCallback();

    /*
     * Otherwise restore the temporary token
     * from this browser tab/session.
     */
    if (!redditAccessToken) {
        loadStoredToken();
    }

    /*
     * Connect the login button.
     */
    const loginButton =
        document.getElementById(
            "redditLogin"
        );

    if (loginButton) {
        /*
         * Avoid attaching duplicate listeners
         * if initReddit() accidentally gets called
         * more than once.
         */
        if (
            loginButton.dataset.redditBound !==
            "true"
        ) {
            loginButton.addEventListener(
                "click",
                loginWithReddit
            );

            loginButton.dataset.redditBound =
                "true";
        }
    }

    updateAuthUI();
}


/*
 * ------------------------------------------------------------
 * Optional debugging helpers
 * ------------------------------------------------------------
 */

export function isRedditLoggedIn() {
    return Boolean(
        redditAccessToken
    );
}


export function logoutReddit() {
    clearRedditToken();
}
