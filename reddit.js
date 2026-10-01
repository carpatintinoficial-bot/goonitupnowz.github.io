import { redditPresets } from './reddit_presets.js'

let redditSlideGroups = [];
let baseUrl = "https://old.reddit.com/r/";
let urlSuffix;
let redditSlideGroupIndex = 0;
let redgifsUrlPattern = /http:\/\/[^.]+/

export async function startReddit() {
    addSubreddit();
    let subreddits = [];
    for (const redditElem of document.getElementsByClassName("pickedSubreddit")) {
        redditElem.innerText.trim().split("+").forEach((sr) => {
            subreddits.push(sr.trim())
        })
    }
    if (subreddits.length == 0) {
        return false;
    }
    const sort = document.getElementById("redditSort").value;
    const time = document.getElementById("redditTime").value
    const roundRobin = document.getElementById("roundRobin").checked
    urlSuffix = "/" + sort + "/"
    urlSuffix += ".json"
    urlSuffix += "?t=" + time
    saveProfile(subreddits, sort, time, roundRobin);
    if (roundRobin) {
        redditSlideGroups = shuffle(subreddits).map((subreddit) => ({subreddits: subreddit, slides: [], isLoading: false}))
    } else {
        redditSlideGroups.push({subreddits: shuffle(subreddits).join("+"), slides: [], isLoading: false})
    }
    await Promise.all(redditSlideGroups.map(obj => loadNextPage(obj)))
    return true
}

function shuffle(array) {
    let currentIndex = array.length,  randomIndex;

    // While there remain elements to shuffle.
    while (currentIndex > 0) {

        // Pick a remaining element.
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;

        // And swap it with the current element.
        [array[currentIndex], array[randomIndex]] = [
        array[randomIndex], array[currentIndex]];
    }

    return array;
}

async function loadNextPage(slideDefinition) {
    if (slideDefinition.after === null) {
        redditSlideGroups.splice(redditSlideGroups.indexOf(slideDefinition), 1)
        redditSlideGroupIndex = redditSlideGroupIndex % redditSlideGroups.length
        return
    }
    if (slideDefinition.isLoading) {
        return
    }
    slideDefinition.isLoading = true;
    let url = baseUrl + slideDefinition.subreddits + urlSuffix + (slideDefinition.after ? "&after=" + slideDefinition.after : "")
    try {
        const response = await fetch(url, { referrerPolicy: 'no-referrer' })
        const jsonResp = await response.json()
        let metadataPromises = []
        slideDefinition.after = jsonResp.data.after
        for (let child of jsonResp.data.children) {
            if (child.data.stickied) {
                continue;
            }
            if (child.data.gallery_data) {
                for (let gallery_child of child.data.gallery_data.items) {
                    const mediaId = gallery_child.media_id
                    const media = child.data.media_metadata[mediaId]
                    if (media) {
                        if (media.m.indexOf("image") === 0) {
                            let fileEnding = media.m.split("/")[1]
                            slideDefinition.slides.push({type: 'short', url: 'https://i.redd.it/' + media.id + '.' + fileEnding, format: 'image', width: media.s.x, height: media.s.y})
                        }
                    }
                }
            } else if (child.data.media_embed && child.data.media_embed.content) {
                let elem = document.createElement("div")
                elem.innerHTML = child.data.media_embed.content
                const decoded = elem.innerText
                slideDefinition.slides.push({type: 'iframe', html: decoded, height: child.data.media_embed.height, width: child.data.media_embed.width})
            } else if (child.data.url && /\.(jpg|jpeg|png|gif|bmp|webp|svg|tiff)$/i.test(child.data.url)) {
                const imgObj = {type: 'short', url: child.data.url, format: 'image'}
                if (child.data.preview && child.data.preview.images && child.data.preview.images[0].source) {
                    imgObj.width = child.data.preview.images[0].source.width
                    imgObj.height = child.data.preview.images[0].source.height
                } else {
                    metadataPromises.push(loadImageMetadata(imgObj));
                }
                slideDefinition.slides.push(imgObj)
            }
        }
        await Promise.all(metadataPromises)
    } catch (e) {
        redditSlideGroups.splice(redditSlideGroups.indexOf(slideDefinition), 1)
    }
    slideDefinition.isLoading = false
}

function loadImageMetadata(imgObj) {
    return new Promise((resolve) => {
        let img = new Image();

        img.onload = async function() {
            imgObj.width = img.width
            imgObj.height = img.height
            resolve()
        };
        img.onerror = async function(e) {
            console.error(e)
            imgObj.width = 1
            imgObj.height = 1
            resolve()
        }

        img.src = imgObj.url
    })
}

function scaleWidth(fitHeight, height, width) {
    let scaleFactor = fitHeight/height
    return width * scaleFactor
}

export async function nextRedditSlides(remainingWidth, height, isEmpty) {
    let toAdd = [];
    let newRemainingWidth = remainingWidth;
    while (newRemainingWidth > 50) {
        while (redditSlideGroups[redditSlideGroupIndex].slides.length === 0) {
            redditSlideGroups.splice(redditSlideGroupIndex, 1)
            redditSlideGroupIndex = redditSlideGroupIndex % redditSlideGroups.length
        }
        let slideInfo = getSlideFromGroup(redditSlideGroups[redditSlideGroupIndex], newRemainingWidth, height, isEmpty)
        if (slideInfo === null) {
            break;
        }
        if (redditSlideGroups[redditSlideGroupIndex].slides.length < 10) {
            console.log("wohoo", redditSlideGroups[redditSlideGroupIndex])
            loadNextPage(redditSlideGroups[redditSlideGroupIndex])
        }
        redditSlideGroupIndex = (redditSlideGroupIndex + 1) % redditSlideGroups.length
        toAdd.push(slideInfo.slide)
        newRemainingWidth = slideInfo.newRemainingWidth
    }
    return toAdd
}

function getSlideFromGroup(redditSlideGroup, remainingWidth, height, isEmpty) {
    let newRemainingWidth = remainingWidth;
    for (let i = 0; i < redditSlideGroup.slides.length && i < 10; i++) {
        let scaledWidth = scaleWidth(height, redditSlideGroup.slides[i].height, redditSlideGroup.slides[i].width)
        redditSlideGroup.slides[i].scaledWidth = scaledWidth
        if (scaledWidth < newRemainingWidth) {
            let slide = redditSlideGroup.slides.splice(i, 1)[0]
            newRemainingWidth -= scaledWidth
            return { slide, newRemainingWidth }
        }
    }
    if (isEmpty) {
        let scaledHeight = scaleWidth(remainingWidth, redditSlideGroup.slides[0].width, redditSlideGroup.slides[0].height)
        let scaledWidth = scaleWidth(scaledHeight, redditSlideGroup.slides[0].height, redditSlideGroup.slides[0].width)
        redditSlideGroup.slides[0].scaledWidth = scaledWidth;
        let slide = redditSlideGroup.slides.splice(0, 1)[0]
        return { slide, newRemainingWidth: 0 }
    }
    return null
}

let subredditInput;
let pickedSubreddits;
let redditTimeContainer;
let profileTextInput;
let profilePicker;

function addSubreddit() {
    const val = subredditInput.value
    if (val.trim() != "") {
        addSubredditValue(val)
        subredditInput.value = ""
    }
}

function addSubredditValue(subredditName) {
    const divElem = document.createElement("div");
    divElem.innerHTML = '<span class="pickedSubreddit">' + subredditName + "</span> <button>Remove</button>";
    divElem.getElementsByTagName("button")[0].onclick = function() { pickedSubreddits.removeChild(divElem) }
    pickedSubreddits.appendChild(divElem)
}

function changeSort() {
    const val = document.getElementById("redditSort").value
    if (val == "top" || val == "controversial") {
        redditTimeContainer.style.display = "flex"
    } else {
        redditTimeContainer.style.display = "none"
    }
}

function setSelectValue(selectElement, value) {
    for (const child of selectElement.children) {
        if (child.value == value) {
            child.setAttribute("selected", "selected")
        } else {
            child.removeAttribute("selected")
        }
    }
}

function profileChanged(event) {
    let profileName = event.target.value.trim()
    if (profileName == "__create") {
        document.getElementById("profileInput").style.display = "flex"
    } else {
        document.getElementById("profileInput").style.display = "none"
    }
    if (profileName.indexOf("__") == -1) {
        let profile;
        if (profileName.indexOf("--preset--") == 0) {
            profileName = profileName.replace("--preset--", "")
            profile = redditPresets.filter(prof => prof.name == profileName)[0]
        } else {
            const redditProfileString = localStorage.getItem("redditProfiles")
            if (redditProfileString == null) {
                return
            }
            const customProfiles = JSON.parse(redditProfileString)
            profile = customProfiles.filter(prof => prof.name == profileName)[0]
        }
        setSelectValue(document.getElementById("redditSort"), profile.sort)
        changeSort()
        setSelectValue(document.getElementById("redditTime"), profile.time)
        pickedSubreddits.innerHTML = ""
        profile.subreddits.forEach(addSubredditValue)
        document.getElementById("roundRobin").checked = !!profile.roundRobin
    }
}

function saveProfile(subreddits, sort, time, roundRobin) {
    let name = profilePicker.value == "__create" ? profileTextInput.value.trim() : profilePicker.value.trim()
    if (name != '__none' && name != '') {
        if (name.indexOf("--preset--") == 0) {
            name = name.replace("--preset--", "")
            let preset = redditPresets.find((profile) => profile.name == name)
            if (preset && preset.subreddits.sort().join() === subreddits.sort().join()) {
                return
            }
        }
        let profilesString = localStorage.getItem("redditProfiles") || "[]"
        let profiles = JSON.parse(profilesString).filter(prof => prof.name != name)
        profiles.push({
            name,
            subreddits,
            sort,
            time,
            roundRobin
        })
        localStorage.setItem("redditProfiles", JSON.stringify(profiles))
    }
}

function fillProfiles() {
    const redditProfileString = localStorage.getItem("redditProfiles")
    const presetGroup = profilePicker.querySelector('optgroup[label="Presets"]')
    for (let preset of redditPresets) {
        const option = document.createElement("option")
        option.setAttribute("value", "--preset--" + preset.name)
        option.innerText = preset.name
        presetGroup.appendChild(option)
    }
    if (redditProfileString) {
        const customGroup = profilePicker.querySelector('optgroup[label="Custom"]')
        const redditProfileNames = JSON.parse(redditProfileString).map(prof => prof.name)
        for (const profileName of redditProfileNames) {
            const option = document.createElement("option")
            option.setAttribute("value", profileName)
            option.innerText = profileName
            customGroup.appendChild(option)
        }
    }
}

export function initReddit() {
    pickedSubreddits = document.getElementById("pickedSubreddits")
    subredditInput = document.getElementById("subredditInput")
    subredditInput.onkeydown = function(e) { if (e.code == 'Enter') { addSubreddit() } }
    document.getElementById("subredditAdd").onclick = addSubreddit

    redditTimeContainer = document.getElementById("redditTimeContainer")
    document.getElementById("redditSort").onchange = changeSort

    profileTextInput = document.getElementById('profileNameInput')
    profilePicker = document.getElementById('profilePicker')
    profilePicker.onchange = profileChanged
    fillProfiles()
}
