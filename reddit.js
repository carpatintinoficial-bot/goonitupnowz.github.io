import { redditPresets } from './reddit_presets.js'

let redditSlideGroups = [];
let baseUrl = "https://oauth.reddit.com/r/";
let urlSuffix;
let redditSlideGroupIndex = 0;
let redgifsUrlPattern = /http:\/\/[^.]+/;

// Reddit OAuth configuration.
//
// IMPORTANT:
// The redirect URI below must be registered in the Reddit application's
// settings and must match exactly.
const REDDIT_CLIENT_ID = "yH0aTnJEt6qUgGn835B4vg";
const REDDIT_REDIRECT_URI =
    "https://carpatintinoficial-bot.github.io/goonitupnowz.github.io/";

const REDDIT_AUTHORIZE_URL =
    "https://www.reddit.com/api/v1/authorize";

const REDDIT_ACCESS_TOKEN_KEY = "redditAccessToken";
const REDDIT_TOKEN_EXPIRY_KEY = "redditTokenExpiry";
const REDDIT_OAUTH_STATE_KEY = "redditOAuthState";


// -----------------------------------------------------------------------------
// OAuth
// -----------------------------------------------------------------------------

function getRedditAccessToken() {
    const token = sessionStorage.getItem(REDDIT_ACCESS_TOKEN_KEY);
    const expiry = Number(sessionStorage.getItem(REDDIT_TOKEN_EXPIRY_KEY) || 0);

    if (!token) {
        return null;
    }

    // Leave a small safety margin so we don't start a request with
    // a token that is about to expire.
    if (expiry && Date.now() >= expiry - 30000) {
        clearRedditAccessToken();
        return null;
    }

    return token;
}

function clearRedditAccessToken() {
    sessionStorage.removeItem(REDDIT_ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(REDDIT_TOKEN_EXPIRY_KEY);
}

function generateOAuthState() {
    if (window.crypto && crypto.randomUUID) {
        return crypto.randomUUID();
    }

    const array = new Uint8Array(16);
    crypto.getRandomValues(array);

    return Array.from(array)
        .map(value => value.toString(16).padStart(2, "0"))
        .join("");
}

function startRedditOAuth() {
    const state = generateOAuthState();

    sessionStorage.setItem(REDDIT_OAUTH_STATE_KEY, state);

    const params = new URLSearchParams({
        client_id: REDDIT_CLIENT_ID,
        response_type: "token",
        state,
        redirect_uri: REDDIT_REDIRECT_URI,
        duration: "temporary",
        scope: "read"
    });

    window.location.href =
        REDDIT_AUTHORIZE_URL + "?" + params.toString();
}

function processRedditOAuthCallback() {
    const hash = window.location.hash;

    if (!hash || hash.length <= 1) {
        return false;
    }

    const params = new URLSearchParams(hash.substring(1));

    const accessToken = params.get("access_token");
    const returnedState = params.get("state");
    const error = params.get("error");

    if (error) {
        console.error("Reddit OAuth error:", error);

        // Remove OAuth parameters from the URL.
        history.replaceState(
            null,
            "",
            window.location.pathname + window.location.search
        );

        return false;
    }

    if (!accessToken) {
        return false;
    }

    const expectedState =
        sessionStorage.getItem(REDDIT_OAUTH_STATE_KEY);

    if (!expectedState || returnedState !== expectedState) {
        console.error("Reddit OAuth state mismatch.");

        clearRedditAccessToken();
        sessionStorage.removeItem(REDDIT_OAUTH_STATE_KEY);

        history.replaceState(
            null,
            "",
            window.location.pathname + window.location.search
        );

        return false;
    }

    const expiresIn =
        Number(params.get("expires_in") || 3600);

    const expiryTime =
        Date.now() + (expiresIn * 1000);

    sessionStorage.setItem(
        REDDIT_ACCESS_TOKEN_KEY,
        accessToken
    );

    sessionStorage.setItem(
        REDDIT_TOKEN_EXPIRY_KEY,
        String(expiryTime)
    );

    sessionStorage.removeItem(REDDIT_OAUTH_STATE_KEY);

    // The access token is in the URL fragment. Remove it from the
    // address bar immediately after reading it.
    history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search
    );

    return true;
}

function ensureRedditLoginUI() {
    let loginContainer =
        document.getElementById("redditLoginContainer");

    if (!loginContainer) {
        loginContainer = document.createElement("div");
        loginContainer.id = "redditLoginContainer";

        loginContainer.style.display = "flex";
        loginContainer.style.alignItems = "center";
        loginContainer.style.gap = "10px";
        loginContainer.style.margin = "10px 0";

        const target =
            document.getElementById("pickedSubreddits") ||
            document.body;

        target.parentNode.insertBefore(
            loginContainer,
            target
        );
    }

    loginContainer.innerHTML = "";

    const token = getRedditAccessToken();

    if (token) {
        const status = document.createElement("span");
        status.innerText = "Reddit connected";
        status.style.color = "#4caf50";

        const logoutButton =
            document.createElement("button");

        logoutButton.innerText = "Disconnect Reddit";

        logoutButton.onclick = function() {
            clearRedditAccessToken();
            ensureRedditLoginUI();
        };

        loginContainer.appendChild(status);
        loginContainer.appendChild(logoutButton);
    } else {
        const loginButton =
            document.createElement("button");

        loginButton.innerText = "Connect Reddit";

        loginButton.onclick = startRedditOAuth;

        loginContainer.appendChild(loginButton);
    }
}


// -----------------------------------------------------------------------------
// Reddit API
// -----------------------------------------------------------------------------

async function redditFetch(url) {
    const accessToken = getRedditAccessToken();

    if (!accessToken) {
        ensureRedditLoginUI();

        throw new Error(
            "Reddit authentication is required. Click 'Connect Reddit'."
        );
    }

    const response = await fetch(url, {
        headers: {
            "Authorization": "Bearer " + accessToken
        },
        referrerPolicy: "no-referrer"
    });

    if (response.status === 401) {
        clearRedditAccessToken();
        ensureRedditLoginUI();

        throw new Error(
            "Reddit access token expired or was rejected."
        );
    }

    if (!response.ok) {
        throw new Error(
            "Reddit API returned HTTP " + response.status
        );
    }

    return response;
}


// -----------------------------------------------------------------------------
// Reddit loading
// -----------------------------------------------------------------------------

export async function startReddit() {
    addSubreddit();

    // Start fresh if startReddit() is called more than once.
    redditSlideGroups = [];
    redditSlideGroupIndex = 0;

    let subreddits = [];

    for (
        const redditElem
        of document.getElementsByClassName("pickedSubreddit")
    ) {
        redditElem.innerText
            .trim()
            .split("+")
            .forEach((sr) => {
                const trimmed = sr.trim();

                if (trimmed !== "") {
                    subreddits.push(trimmed);
                }
            });
    }

    if (subreddits.length === 0) {
        return false;
    }

    const sort =
        document.getElementById("redditSort").value;

    const time =
        document.getElementById("redditTime").value;

    const roundRobin =
        document.getElementById("roundRobin").checked;

    urlSuffix =
        "/" +
        sort +
        ".json?t=" +
        encodeURIComponent(time);

    saveProfile(
        subreddits,
        sort,
        time,
        roundRobin
    );

    if (roundRobin) {
        redditSlideGroups =
            shuffle(subreddits).map((subreddit) => ({
                subreddits: subreddit,
                slides: [],
                isLoading: false,
                after: undefined
            }));
    } else {
        redditSlideGroups.push({
            subreddits: shuffle(subreddits).join("+"),
            slides: [],
            isLoading: false,
            after: undefined
        });
    }

    ensureRedditLoginUI();

    if (!getRedditAccessToken()) {
        return false;
    }

    await Promise.all(
        redditSlideGroups.map(obj => loadNextPage(obj))
    );

    return redditSlideGroups.length > 0;
}

function shuffle(array) {
    const copy = [...array];

    let currentIndex = copy.length;
    let randomIndex;

    while (currentIndex > 0) {
        randomIndex =
            Math.floor(Math.random() * currentIndex);

        currentIndex--;

        [
            copy[currentIndex],
            copy[randomIndex]
        ] = [
            copy[randomIndex],
            copy[currentIndex]
        ];
    }

    return copy;
}

async function loadNextPage(slideDefinition) {
    if (!slideDefinition) {
        return;
    }

    if (slideDefinition.after === null) {
        const index =
            redditSlideGroups.indexOf(slideDefinition);

        if (index !== -1) {
            redditSlideGroups.splice(index, 1);
        }

        if (redditSlideGroups.length > 0) {
            redditSlideGroupIndex =
                redditSlideGroupIndex %
                redditSlideGroups.length;
        } else {
            redditSlideGroupIndex = 0;
        }

        return;
    }

    if (slideDefinition.isLoading) {
        return;
    }

    slideDefinition.isLoading = true;

    let url =
        baseUrl +
        slideDefinition.subreddits +
        urlSuffix;

    if (slideDefinition.after) {
        url +=
            "&after=" +
            encodeURIComponent(slideDefinition.after);
    }

    try {
        const response =
            await redditFetch(url);

        const jsonResp =
            await response.json();

        if (
            !jsonResp ||
            !jsonResp.data ||
            !Array.isArray(jsonResp.data.children)
        ) {
            throw new Error(
                "Reddit returned an unexpected response."
            );
        }

        let metadataPromises = [];

        slideDefinition.after =
            jsonResp.data.after;

        for (
            let child
            of jsonResp.data.children
        ) {
            if (child.data.stickied) {
                continue;
            }

            if (child.data.gallery_data) {
                for (
                    let gallery_child
                    of child.data.gallery_data.items
                ) {
                    const mediaId =
                        gallery_child.media_id;

                    const media =
                        child.data.media_metadata &&
                        child.data.media_metadata[mediaId];

                    if (media) {
                        if (
                            media.m &&
                            media.m.indexOf("image") === 0
                        ) {
                            const fileEnding =
                                media.m.split("/")[1];

                            slideDefinition.slides.push({
                                type: "short",
                                url:
                                    "https://i.redd.it/" +
                                    media.id +
                                    "." +
                                    fileEnding,
                                format: "image",
                                width: media.s.x,
                                height: media.s.y
                            });
                        }
                    }
                }
            } else if (
                child.data.media_embed &&
                child.data.media_embed.content
            ) {
                const elem =
                    document.createElement("div");

                elem.innerHTML =
                    child.data.media_embed.content;

                const decoded =
                    elem.innerText;

                slideDefinition.slides.push({
                    type: "iframe",
                    html: decoded,
                    height:
                        child.data.media_embed.height,
                    width:
                        child.data.media_embed.width
                });
            } else if (
                child.data.url &&
                /\.(jpg|jpeg|png|gif|bmp|webp|svg|tiff)$/i
                    .test(child.data.url)
            ) {
                const imgObj = {
                    type: "short",
                    url: child.data.url,
                    format: "image"
                };

                if (
                    child.data.preview &&
                    child.data.preview.images &&
                    child.data.preview.images[0] &&
                    child.data.preview.images[0].source
                ) {
                    imgObj.width =
                        child.data.preview.images[0].source.width;

                    imgObj.height =
                        child.data.preview.images[0].source.height;
                } else {
                    metadataPromises.push(
                        loadImageMetadata(imgObj)
                    );
                }

                slideDefinition.slides.push(imgObj);
            }
        }

        await Promise.all(metadataPromises);

    } catch (e) {
        console.error(
            "Failed to load Reddit page:",
            e
        );

        const index =
            redditSlideGroups.indexOf(slideDefinition);

        if (index !== -1) {
            redditSlideGroups.splice(index, 1);
        }

        if (redditSlideGroups.length > 0) {
            redditSlideGroupIndex =
                redditSlideGroupIndex %
                redditSlideGroups.length;
        } else {
            redditSlideGroupIndex = 0;
        }
    }

    slideDefinition.isLoading = false;
}

function loadImageMetadata(imgObj) {
    return new Promise((resolve) => {
        const img = new Image();

        img.onload = function() {
            imgObj.width = img.width;
            imgObj.height = img.height;
            resolve();
        };

        img.onerror = function(e) {
            console.error(e);

            imgObj.width = 1;
            imgObj.height = 1;

            resolve();
        };

        img.src = imgObj.url;
    });
}

function scaleWidth(
    fitHeight,
    height,
    width
) {
    const scaleFactor =
        fitHeight / height;

    return width * scaleFactor;
}

export async function nextRedditSlides(
    remainingWidth,
    height,
    isEmpty
) {
    const toAdd = [];
    let newRemainingWidth = remainingWidth;

    while (
        newRemainingWidth > 50 &&
        redditSlideGroups.length > 0
    ) {
        if (
            redditSlideGroupIndex >=
            redditSlideGroups.length
        ) {
            redditSlideGroupIndex = 0;
        }

        const currentGroup =
            redditSlideGroups[
                redditSlideGroupIndex
            ];

        if (!currentGroup) {
            break;
        }

        while (
            currentGroup.slides.length === 0 &&
            !currentGroup.isLoading
        ) {
            await loadNextPage(currentGroup);

            if (
                !redditSlideGroups.includes(currentGroup)
            ) {
                break;
            }
        }

        if (
            !redditSlideGroups.includes(currentGroup)
        ) {
            if (redditSlideGroups.length === 0) {
                break;
            }

            redditSlideGroupIndex =
                redditSlideGroupIndex %
                redditSlideGroups.length;

            continue;
        }

        const slideInfo =
            getSlideFromGroup(
                currentGroup,
                newRemainingWidth,
                height,
                isEmpty
            );

        if (slideInfo === null) {
            break;
        }

        if (
            currentGroup.slides.length < 10 &&
            !currentGroup.isLoading &&
            currentGroup.after !== null
        ) {
            loadNextPage(currentGroup);
        }

        redditSlideGroupIndex =
            (redditSlideGroupIndex + 1) %
            redditSlideGroups.length;

        toAdd.push(slideInfo.slide);

        newRemainingWidth =
            slideInfo.newRemainingWidth;
    }

    return toAdd;
}

function getSlideFromGroup(
    redditSlideGroup,
    remainingWidth,
    height,
    isEmpty
) {
    let newRemainingWidth =
        remainingWidth;

    for (
        let i = 0;
        i < redditSlideGroup.slides.length &&
        i < 10;
        i++
    ) {
        const slide =
            redditSlideGroup.slides[i];

        if (
            !slide.height ||
            !slide.width
        ) {
            continue;
        }

        const scaledWidth =
            scaleWidth(
                height,
                slide.height,
                slide.width
            );

        slide.scaledWidth =
            scaledWidth;

        if (
            scaledWidth <
            newRemainingWidth
        ) {
            const selected =
                redditSlideGroup.slides
                    .splice(i, 1)[0];

            newRemainingWidth -=
                scaledWidth;

            return {
                slide: selected,
                newRemainingWidth
            };
        }
    }

    if (
        isEmpty &&
        redditSlideGroup.slides.length > 0
    ) {
        const first =
            redditSlideGroup.slides[0];

        if (
            first.width &&
            first.height
        ) {
            const scaledHeight =
                scaleWidth(
                    remainingWidth,
                    first.width,
                    first.height
                );

            const scaledWidth =
                scaleWidth(
                    scaledHeight,
                    first.height,
                    first.width
                );

            first.scaledWidth =
                scaledWidth;
        }

        const slide =
            redditSlideGroup.slides
                .splice(0, 1)[0];

        return {
            slide,
            newRemainingWidth: 0
        };
    }

    return null;
}


// -----------------------------------------------------------------------------
// UI / Profiles
// -----------------------------------------------------------------------------

let subredditInput;
let pickedSubreddits;
let redditTimeContainer;
let profileTextInput;
let profilePicker;

function addSubreddit() {
    const val =
        subredditInput.value;

    if (val.trim() !== "") {
        addSubredditValue(val);

        subredditInput.value = "";
    }
}

function addSubredditValue(subredditName) {
    const divElem =
        document.createElement("div");

    divElem.innerHTML =
        '<span class="pickedSubreddit">' +
        subredditName +
        "</span> <button>Remove</button>";

    divElem
        .getElementsByTagName("button")[0]
        .onclick = function() {
            pickedSubreddits.removeChild(
                divElem
            );
        };

    pickedSubreddits.appendChild(
        divElem
    );
}

function changeSort() {
    const val =
        document.getElementById(
            "redditSort"
        ).value;

    if (
        val === "top" ||
        val === "controversial"
    ) {
        redditTimeContainer.style.display =
            "flex";
    } else {
        redditTimeContainer.style.display =
            "none";
    }
}

function setSelectValue(
    selectElement,
    value
) {
    for (
        const child
        of selectElement.children
    ) {
        if (
            child.value == value
        ) {
            child.setAttribute(
                "selected",
                "selected"
            );
        } else {
            child.removeAttribute(
                "selected"
            );
        }
    }
}

function profileChanged(event) {
    let profileName =
        event.target.value.trim();

    if (
        profileName === "__create"
    ) {
        document.getElementById(
            "profileInput"
        ).style.display = "flex";
    } else {
        document.getElementById(
            "profileInput"
        ).style.display = "none";
    }

    if (
        profileName.indexOf("__") === -1
    ) {
        let profile;

        if (
            profileName.indexOf(
                "--preset--"
            ) === 0
        ) {
            profileName =
                profileName.replace(
                    "--preset--",
                    ""
                );

            profile =
                redditPresets.filter(
                    prof =>
                        prof.name ==
                        profileName
                )[0];
        } else {
            const redditProfileString =
                localStorage.getItem(
                    "redditProfiles"
                );

            if (
                redditProfileString == null
            ) {
                return;
            }

            const customProfiles =
                JSON.parse(
                    redditProfileString
                );

            profile =
                customProfiles.filter(
                    prof =>
                        prof.name ==
                        profileName
                )[0];
        }

        if (!profile) {
            return;
        }

        setSelectValue(
            document.getElementById(
                "redditSort"
            ),
            profile.sort
        );

        changeSort();

        setSelectValue(
            document.getElementById(
                "redditTime"
            ),
            profile.time
        );

        pickedSubreddits.innerHTML =
            "";

        profile.subreddits.forEach(
            addSubredditValue
        );

        document.getElementById(
            "roundRobin"
        ).checked =
            !!profile.roundRobin;
    }
}

function saveProfile(
    subreddits,
    sort,
    time,
    roundRobin
) {
    let name =
        profilePicker.value === "__create"
            ? profileTextInput.value.trim()
            : profilePicker.value.trim();

    if (
        name !== "__none" &&
        name !== ""
    ) {
        if (
            name.indexOf(
                "--preset--"
            ) === 0
        ) {
            name =
                name.replace(
                    "--preset--",
                    ""
                );

            const preset =
                redditPresets.find(
                    profile =>
                        profile.name ===
                        name
                );

            if (
                preset &&
                preset.subreddits.sort().join() ===
                    subreddits.sort().join()
            ) {
                return;
            }
        }

        const profilesString =
            localStorage.getItem(
                "redditProfiles"
            ) || "[]";

        const profiles =
            JSON.parse(
                profilesString
            ).filter(
                prof =>
                    prof.name !== name
            );

        profiles.push({
            name,
            subreddits,
            sort,
            time,
            roundRobin
        });

        localStorage.setItem(
            "redditProfiles",
            JSON.stringify(profiles)
        );
    }
}

function fillProfiles() {
    const redditProfileString =
        localStorage.getItem(
            "redditProfiles"
        );

    const presetGroup =
        profilePicker.querySelector(
            'optgroup[label="Presets"]'
        );

    for (
        const preset
        of redditPresets
    ) {
        const option =
            document.createElement(
                "option"
            );

        option.setAttribute(
            "value",
            "--preset--" +
            preset.name
        );

        option.innerText =
            preset.name;

        presetGroup.appendChild(
            option
        );
    }

    if (redditProfileString) {
        const customGroup =
            profilePicker.querySelector(
                'optgroup[label="Custom"]'
            );

        const redditProfileNames =
            JSON.parse(
                redditProfileString
            ).map(
                prof => prof.name
            );

        for (
            const profileName
            of redditProfileNames
        ) {
            const option =
                document.createElement(
                    "option"
                );

            option.setAttribute(
                "value",
                profileName
            );

            option.innerText =
                profileName;

            customGroup.appendChild(
                option
            );
        }
    }
}


// -----------------------------------------------------------------------------
// Initialization
// -----------------------------------------------------------------------------

export function initReddit() {
    // Process a token returned by Reddit before doing anything else.
    processRedditOAuth();

    pickedSubreddits =
        document.getElementById(
            "pickedSubreddits"
        );

    subredditInput =
        document.getElementById(
            "subredditInput"
        );

    subredditInput.onkeydown =
        function(e) {
            if (e.code === "Enter") {
                addSubreddit();
            }
        };

    document.getElementById(
        "subredditAdd"
    ).onclick =
        addSubreddit;

    redditTimeContainer =
        document.getElementById(
            "redditTimeContainer"
        );

    document.getElementById(
        "redditSort"
    ).onchange =
        changeSort;

    profileTextInput =
        document.getElementById(
            "profileNameInput"
        );

    profilePicker =
        document.getElementById(
            "profilePicker"
        );

    profilePicker.onchange =
        profileChanged;

    fillProfiles();

    ensureRedditLoginUI();
}
