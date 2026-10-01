import { redditPresets } from './reddit_presets.js'

const REDDIT_CLIENT_ID = "yH0aTnJEt6qUgGn835B4vg"
const REDDIT_USER_AGENT = "org.quantumbadger.redreader/1.25.1"

const REDDIT_API_BASE = "https://oauth.reddit.com/r/"
const REDDIT_AUTHORIZE_URL = "https://www.reddit.com/api/v1/authorize"

const REDDIT_REDIRECT_URI = "redreader://rr_oauth_redir"

let redditSlideGroups = [];
let urlSuffix;
let redditSlideGroupIndex = 0;

let subredditInput;
let pickedSubreddits;
let redditTimeContainer;
let profileTextInput;
let profilePicker;


/*
 * Reddit OAuth
 *
 * IMPORTANT:
 * The client ID identifies the Reddit application.
 * API requests themselves require an OAuth access token.
 *
 * This file looks for the token in:
 *
 *     localStorage.redditAccessToken
 *
 * For example:
 *
 *     localStorage.setItem("redditAccessToken", "YOUR_ACCESS_TOKEN")
 *
 * The access token must have the "read" scope.
 */

function getAccessToken() {
    return localStorage.getItem("redditAccessToken");
}


function setAccessToken(token) {
    if (!token) {
        localStorage.removeItem("redditAccessToken");
        return;
    }

    localStorage.setItem("redditAccessToken", token);
}


function clearAccessToken() {
    localStorage.removeItem("redditAccessToken");
}


/*
 * Starts the Reddit OAuth authorization flow.
 *
 * NOTE:
 * REDDIT_REDIRECT_URI must exactly match a redirect URI registered
 * for the Reddit application.
 *
 * The supplied RedReader redirect URI:
 *
 *     redreader://rr_oauth_redir
 *
 * is intended for the RedReader application and cannot normally
 * redirect a browser back into a GitHub Pages website.
 */
export function startRedditOAuth() {
    const state = crypto.randomUUID();

    sessionStorage.setItem("redditOAuthState", state);

    const params = new URLSearchParams({
        client_id: REDDIT_CLIENT_ID,
        response_type: "token",
        state: state,
        redirect_uri: REDDIT_REDIRECT_URI,
        duration: "permanent",
        scope: "read"
    });

    window.location.href =
        REDDIT_AUTHORIZE_URL + "?" + params.toString();
}


/*
 * Handles an OAuth implicit-grant response if Reddit redirected
 * back to this page with an access_token in the URL fragment.
 *
 * This will only work if REDDIT_REDIRECT_URI points to this web
 * application. It cannot receive redreader://rr_oauth_redir in
 * an ordinary GitHub Pages browser session.
 */
function processOAuthResponse() {
    if (!window.location.hash) {
        return;
    }

    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);

    const accessToken = params.get("access_token");
    const state = params.get("state");
    const storedState = sessionStorage.getItem("redditOAuthState");

    if (!accessToken) {
        return;
    }

    if (storedState && state !== storedState) {
        console.error("Reddit OAuth state mismatch");
        return;
    }

    setAccessToken(accessToken);

    sessionStorage.removeItem("redditOAuthState");

    history.replaceState(
        null,
        document.title,
        window.location.pathname + window.location.search
    );
}


/*
 * Perform an authenticated Reddit API request.
 */
async function redditFetch(url) {
    const accessToken = getAccessToken();

    if (!accessToken) {
        throw new Error(
            "No Reddit OAuth access token. Authenticate with Reddit first."
        );
    }

    const response = await fetch(url, {
        method: "GET",
        headers: {
            "Authorization": "Bearer " + accessToken,
            "User-Agent": REDDIT_USER_AGENT
        }
    });

    if (response.status === 401) {
        clearAccessToken();

        throw new Error(
            "Reddit OAuth access token expired or is invalid."
        );
    }

    if (!response.ok) {
        throw new Error(
            "Reddit API returned HTTP " +
            response.status +
            " for " +
            url
        );
    }

    return response.json();
}


export async function startReddit() {
    addSubreddit();

    let subreddits = [];

    for (const redditElem of document.getElementsByClassName("pickedSubreddit")) {
        redditElem.innerText.trim().split("+").forEach((sr) => {
            const subreddit = sr.trim();

            if (subreddit !== "") {
                subreddits.push(subreddit);
            }
        });
    }

    if (subreddits.length === 0) {
        return false;
    }

    if (!getAccessToken()) {
        console.error(
            "No Reddit OAuth access token. Start the Reddit OAuth flow first."
        );

        startRedditOAuth();

        return false;
    }

    const sort = document.getElementById("redditSort").value;
    const time = document.getElementById("redditTime").value;
    const roundRobin = document.getElementById("roundRobin").checked;

    urlSuffix = "/" + sort + ".json?t=" + encodeURIComponent(time);

    saveProfile(
        subreddits,
        sort,
        time,
        roundRobin
    );

    /*
     * Reset the previous Reddit session.
     */
    redditSlideGroups = [];
    redditSlideGroupIndex = 0;

    if (roundRobin) {
        redditSlideGroups = shuffle(subreddits).map((subreddit) => ({
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

    await Promise.all(
        redditSlideGroups.map(obj => loadNextPage(obj))
    );

    return redditSlideGroups.length > 0;
}


function shuffle(array) {
    const copy = [...array];

    let currentIndex = copy.length;

    while (currentIndex > 0) {
        const randomIndex =
            Math.floor(Math.random() * currentIndex);

        currentIndex--;

        [copy[currentIndex], copy[randomIndex]] = [
            copy[randomIndex],
            copy[currentIndex]
        ];
    }

    return copy;
}


async function loadNextPage(slideDefinition) {
    if (
        slideDefinition.after === null
    ) {
        const index =
            redditSlideGroups.indexOf(slideDefinition);

        if (index !== -1) {
            redditSlideGroups.splice(index, 1);
        }

        if (redditSlideGroups.length > 0) {
            redditSlideGroupIndex =
                redditSlideGroupIndex % redditSlideGroups.length;
        }

        return;
    }

    if (slideDefinition.isLoading) {
        return;
    }

    slideDefinition.isLoading = true;

    let url =
        REDDIT_API_BASE +
        slideDefinition.subreddits +
        urlSuffix;

    if (slideDefinition.after) {
        url += "&after=" +
            encodeURIComponent(slideDefinition.after);
    }

    try {
        const jsonResp = await redditFetch(url);

        if (
            !jsonResp ||
            !jsonResp.data ||
            !Array.isArray(jsonResp.data.children)
        ) {
            throw new Error("Unexpected Reddit API response.");
        }

        slideDefinition.after = jsonResp.data.after;

        let metadataPromises = [];

        for (const child of jsonResp.data.children) {
            const data = child.data;

            if (data.stickied) {
                continue;
            }

            if (data.gallery_data && data.media_metadata) {
                for (const galleryChild of data.gallery_data.items) {
                    const mediaId = galleryChild.media_id;
                    const media = data.media_metadata[mediaId];

                    if (!media) {
                        continue;
                    }

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

                continue;
            }

            if (
                data.media_embed &&
                data.media_embed.content
            ) {
                const elem =
                    document.createElement("div");

                elem.innerHTML =
                    data.media_embed.content;

                const decoded = elem.innerText;

                slideDefinition.slides.push({
                    type: "iframe",
                    html: decoded,
                    height: data.media_embed.height,
                    width: data.media_embed.width
                });

                continue;
            }

            if (
                data.url &&
                /\.(jpg|jpeg|png|gif|bmp|webp|svg|tiff)$/i.test(data.url)
            ) {
                const imgObj = {
                    type: "short",
                    url: data.url,
                    format: "image"
                };

                if (
                    data.preview &&
                    data.preview.images &&
                    data.preview.images[0] &&
                    data.preview.images[0].source
                ) {
                    imgObj.width =
                        data.preview.images[0].source.width;

                    imgObj.height =
                        data.preview.images[0].source.height;
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
                redditSlideGroupIndex % redditSlideGroups.length;
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
            console.error(
                "Could not load image:",
                imgObj.url,
                e
            );

            imgObj.width = 1;
            imgObj.height = 1;

            resolve();
        };

        img.src = imgObj.url;
    });
}


function scaleWidth(fitHeight, height, width) {
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
            !redditSlideGroups[redditSlideGroupIndex]
        ) {
            redditSlideGroupIndex = 0;
        }

        while (
            redditSlideGroups.length > 0 &&
            redditSlideGroups[redditSlideGroupIndex].slides.length === 0
        ) {
            const group =
                redditSlideGroups[redditSlideGroupIndex];

            if (group.isLoading) {
                return toAdd;
            }

            redditSlideGroups.splice(
                redditSlideGroupIndex,
                1
            );

            if (redditSlideGroups.length === 0) {
                return toAdd;
            }

            redditSlideGroupIndex =
                redditSlideGroupIndex %
                redditSlideGroups.length;
        }

        if (redditSlideGroups.length === 0) {
            break;
        }

        const group =
            redditSlideGroups[redditSlideGroupIndex];

        const slideInfo =
            getSlideFromGroup(
                group,
                newRemainingWidth,
                height,
                isEmpty
            );

        if (slideInfo === null) {
            break;
        }

        if (
            group.slides.length < 10 &&
            !group.isLoading &&
            group.after !== null
        ) {
            loadNextPage(group);
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

        const scaledWidth =
            scaleWidth(
                height,
                slide.height,
                slide.width
            );

        slide.scaledWidth =
            scaledWidth;

        if (
            scaledWidth < newRemainingWidth
        ) {
            const selected =
                redditSlideGroup.slides.splice(
                    i,
                    1
                )[0];

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

        const selected =
            redditSlideGroup.slides.splice(
                0,
                1
            )[0];

        return {
            slide: selected,
            newRemainingWidth: 0
        };
    }

    return null;
}


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

    /*
     * Use textContent rather than innerHTML here.
     * This prevents subreddit input from being interpreted
     * as HTML.
     */
    const span =
        document.createElement("span");

    span.className =
        "pickedSubreddit";

    span.innerText =
        subredditName;

    const button =
        document.createElement("button");

    button.innerText =
        "Remove";

    divElem.appendChild(span);
    divElem.appendChild(
        document.createTextNode(" ")
    );
    divElem.appendChild(button);

    button.onclick = function() {
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
        const child of selectElement.children
    ) {
        if (child.value === value) {
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

    if (profileName === "__create") {
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
            profileName.indexOf("--preset--") === 0
        ) {
            profileName =
                profileName.replace(
                    "--preset--",
                    ""
                );

            profile =
                redditPresets.filter(
                    prof =>
                        prof.name === profileName
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
                        prof.name === profileName
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

        pickedSubreddits.innerHTML = "";

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
            name.indexOf("--preset--") === 0
        ) {
            name =
                name.replace(
                    "--preset--",
                    ""
                );

            const preset =
                redditPresets.find(
                    profile =>
                        profile.name === name
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
        const preset of redditPresets
    ) {
        const option =
            document.createElement("option");

        option.setAttribute(
            "value",
            "--preset--" + preset.name
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
            const profileName of redditProfileNames
        ) {
            const option =
                document.createElement("option");

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


export function initReddit() {
    /*
     * Process an OAuth response if one is
     * present in the URL.
     */
    processOAuthResponse();

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
}
