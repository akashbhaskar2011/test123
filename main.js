const CLIENT_ID = '818094321753-cetemam3aj5qf3tv14m58ul0m5mq7c0f.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly email';
const BIN_ID = "68489c7d8561e97a50221bf4";
const API_KEY = "$2a$10$aYWAwHAFXqk64iURuD5NpO/LJpseUwX7tvsN5ROwvIjk6jEPSKHHu";

let accessToken = null;
let userEmail = localStorage.getItem('userEmail');
let token = localStorage.getItem('gmailToken');
let nextPageToken = null;
let unsubscribeLinks = [];
let selectionLimit = 5;
let adInProgress = false;

document.addEventListener("DOMContentLoaded", () => {
  const loginButton = document.getElementById("login-button");
  const unsubscribeButton = document.getElementById("unsubscribe-button");
  const resultsDiv = document.getElementById("results");
  const loadMoreButton = document.getElementById("load-more-button");
  const scanStats = document.getElementById("scan-stats");

  const redirectUri = window.location.origin + window.location.pathname;

  console.log("main.js loaded");

  function getUserEmail(token, callback) {
    fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        if (data.email) {
          callback(data.email);
        } else {
          alert("Could not fetch user email.");
        }
      });
  }

  function extractUnsubscribeLinks(emails) {
    const links = [];
    const seenDomains = new Set();
    const unsubscribed = JSON.parse(localStorage.getItem("unsubscribedLinks") || "[]");

    emails.forEach(email => {
      const headers = email.payload?.headers || [];
      const unsubHeader = headers.find(h => h.name.toLowerCase() === "list-unsubscribe");
      if (unsubHeader) {
        const matches = unsubHeader.value.match(/<([^>]+)>/g) || [];
        matches.forEach(match => {
          const url = match.replace(/[<>]/g, '');
          if (url.startsWith("http")) {
            try {
              const domain = new URL(url).hostname.replace(/^www\./, "");
              if (!seenDomains.has(domain) && !unsubscribed.includes(url)) {
                seenDomains.add(domain);
                links.push(url);
              }
            } catch (e) {}
          }
        });
      }
    });
    return links;
  }

  function renderLinks(links) {
    const unsubscribed = JSON.parse(localStorage.getItem("unsubscribedLinks") || "[]");
    // Filter out unsubscribed links
    const filtered = links.filter(link => !unsubscribed.includes(link));
    const toShow = filtered.slice(0, selectionLimit);

    resultsDiv.innerHTML = "";
    if (toShow.length === 0) {
      resultsDiv.innerHTML = "<p>No unsubscribe links found.</p>";
      unsubscribeButton.disabled = true;
      loadMoreButton.style.display = "none";
      return;
    }

    const selectedLinks = getSelectedLinks();
    // Render checkboxes: only first 5 are checked, rest are unchecked
    toShow.forEach((link, idx) => {
      const domain = new URL(link).hostname.replace(/^www\./, "");
      const favicon = `https://www.google.com/s2/favicons?domain=${domain}`;
      const checked = selectedLinks.includes(link); // <-- Only check if previously selected
      const div = document.createElement("div");
      div.innerHTML = `
        <input type="checkbox" class="unsub-checkbox" value="${link}" ${checked ? "checked" : ""}>
        <img src="${favicon}" alt="${domain}" style="vertical-align: middle; margin-right: 6px;" onerror="this.style.display='none';">
        ${domain}
      `;
      resultsDiv.appendChild(div);
    });

    unsubscribeButton.disabled = false;
    if (filtered.length > selectionLimit || nextPageToken) {
      loadMoreButton.style.display = "block";
    } else {
      loadMoreButton.style.display = "none";
    }

    // --- Ad gating logic for every 5 selections ---
    const checkboxes = Array.from(document.querySelectorAll(".unsub-checkbox"));
    let adShownFor = parseInt(localStorage.getItem("adShownFor") || "5", 10);

    checkboxes.forEach(cb => {
      cb.addEventListener("change", function () {
        let selected = getSelectedLinks();
        if (this.checked) {
          if (selected.length >= selectionLimit) {
            this.checked = false;
            alert(`You can only select up to ${selectionLimit} at a time. Please unsubscribe or deselect some first.`);
            return;
          }
          selected.push(this.value);
        } else {
          selected = selected.filter(link => link !== this.value);
        }
        setSelectedLinks(selected);

        // Ad gating logic
        const checkedCount = selected.length;
        if (checkedCount > 0 && checkedCount % 5 === 0 && checkedCount > adShownFor) {
          adShownFor = checkedCount;
          localStorage.setItem("adShownFor", adShownFor);
          showAdInPage(() => {
            selectionLimit += 5;
            renderLinks(unsubscribeLinks);
          });
        }
        if (checkedCount < adShownFor) {
          adShownFor = checkedCount;
          localStorage.setItem("adShownFor", adShownFor);
        }
      });
    });
  }

  async function fetchEmails(token, pageToken = null) {
    let url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=unsubscribe&maxResults=100`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    const messages = data.messages || [];
    const fullMessages = await Promise.all(
      messages.map(msg =>
        fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=List-Unsubscribe`, {
          headers: { Authorization: `Bearer ${token}` }
        }).then(res => res.json())
      )
    );
    return { emails: fullMessages, nextPage: data.nextPageToken };
  }

  async function fetchAndRenderEmails(token, pageToken = null) {
    scanStats.textContent = "Scanning for subscriptions...";
    try {
      const { emails, nextPage } = await fetchEmails(token, pageToken);
      const links = extractUnsubscribeLinks(emails);
      unsubscribeLinks = unsubscribeLinks.concat(links);
      renderLinks(unsubscribeLinks);
      scanStats.textContent = `Found ${unsubscribeLinks.length} subscriptions.`;
      nextPageToken = nextPage;
      if (userEmail) updateStats(userEmail, 0, emails.length);
    } catch (err) {
      scanStats.textContent = "Error fetching emails.";
      console.error(err);
    }
  }

  loginButton.addEventListener("click", () => {
    if (token) {
      token = null;
      userEmail = null;
      localStorage.removeItem('gmailToken');
      localStorage.removeItem('userEmail');
      loginButton.textContent = "Log in to Gmail";
      resultsDiv.innerHTML = "";
      unsubscribeButton.disabled = true;
      loadMoreButton.style.display = "none";
      scanStats.textContent = "";
      alert("Logged out.");
    } else {
      const authUrl = `https://accounts.google.com/o/oauth2/auth?client_id=${CLIENT_ID}` +
        `&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${encodeURIComponent(SCOPES)}` +
        `&prompt=select_account`;
      window.location.href = authUrl;
    }
  });

  unsubscribeButton.addEventListener("click", () => {
    const checked = Array.from(document.querySelectorAll("input[type=checkbox]:checked"));
    let count = 0;
    const unsubscribedNow = [];

    checked.forEach((checkbox) => {
      const url = checkbox.value;
      window.open(url, "_blank");
      unsubscribedNow.push(url);
      count++;
    });

    const saved = JSON.parse(localStorage.getItem("unsubscribedLinks") || "[]");
    const allUnsubscribed = Array.from(new Set([...saved, ...unsubscribedNow]));
    localStorage.setItem("unsubscribedLinks", JSON.stringify(allUnsubscribed));

    unsubscribeLinks = unsubscribeLinks.filter(link => !allUnsubscribed.includes(link));
    renderLinks(unsubscribeLinks);
    unsubscribeButton.disabled = unsubscribeLinks.length === 0;

    if (userEmail) updateStats(userEmail, count, 0);
    alert(`Unsubscribed from ${count} emails.`);
  });

  loadMoreButton.addEventListener("click", () => {
    selectionLimit += 5;
    const unsubscribed = JSON.parse(localStorage.getItem("unsubscribedLinks") || "[]");
    const filtered = unsubscribeLinks.filter(link => !unsubscribed.includes(link));
    if (filtered.length > selectionLimit) {
      renderLinks(unsubscribeLinks);
    } else if (nextPageToken) {
      fetchAndRenderEmails(token, nextPageToken);
    } else {
      renderLinks(unsubscribeLinks);
      alert("No more emails to load.");
    }
  });

  function showAdInPage(onAdViewed) {
    adInProgress = true;
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.top = 0;
    overlay.style.left = 0;
    overlay.style.width = "100vw";
    overlay.style.height = "100vh";
    overlay.style.background = "rgba(0,0,0,0.8)";
    overlay.style.display = "flex";
    overlay.style.flexDirection = "column";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = 9999;

    const adBox = document.createElement("div");
    adBox.style.background = "#fff";
    adBox.style.padding = "30px";
    adBox.style.borderRadius = "10px";
    adBox.style.textAlign = "center";
    adBox.innerHTML = `
      <h2>Watch this ad to unlock more!</h2>
      <p style="margin-bottom:20px;">(Ad: Please wait 5 seconds...)</p>
      <div id="adsense-ad" style="margin-bottom:20px;">
        <!-- AdSense ad will be injected here -->
      </div>
      <button id="skip-ad-btn" style="margin-top:10px;">Skip Ad</button>
    `;

    overlay.appendChild(adBox);
    document.body.appendChild(overlay);

    // Inject AdSense script and ad container
    const adsenseScript = document.createElement("script");
    adsenseScript.async = true;
    adsenseScript.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7128422467368498";
    adsenseScript.crossOrigin = "anonymous";
    document.getElementById("adsense-ad").appendChild(adsenseScript);

    // Optionally, add an <ins> tag for a responsive ad unit
    const ins = document.createElement("ins");
    ins.className = "adsbygoogle";
    ins.style.display = "block";
    ins.setAttribute("data-ad-client", "ca-pub-7128422467368498");
    ins.setAttribute("data-ad-slot", "1234567890"); // Replace with your ad slot
    ins.setAttribute("data-ad-format", "auto");
    document.getElementById("adsense-ad").appendChild(ins);

    // Trigger adsbygoogle (required for AdSense)
    const adsbygoogle = window.adsbygoogle || [];
    adsbygoogle.push({});

    let adTimer = setTimeout(() => {
      document.body.removeChild(overlay);
      adInProgress = false;
      if (typeof onAdViewed === "function") onAdViewed();
      alert("Thanks for watching the ad! You can now load more.");
    }, 5000);

    function deselectLast5() {
      let selected = getSelectedLinks();
      if (selected.length > 0) {
        selected = selected.slice(0, selected.length - 5);
        setSelectedLinks(selected);
        renderLinks(unsubscribeLinks);
      }
    }

    adBox.querySelector("#skip-ad-btn").addEventListener("click", () => {
      clearTimeout(adTimer);
      document.body.removeChild(overlay);
      adInProgress = false;
      deselectLast5();
      alert("Ad skipped. The last 5 selections have been deselected. Please watch the full ad to unlock more.");
    });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        clearTimeout(adTimer);
        document.body.removeChild(overlay);
        adInProgress = false;
        deselectLast5();
        alert("Ad closed early. The last 5 selections have been deselected. Please watch the full ad to unlock more.");
      }
    });
  }

  function updateStats(userId, unsubCount, scannedCount = 0) {
    fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
      headers: { "X-Master-Key": API_KEY }
    })
      .then(res => res.json())
      .then(data => {
        const stats = data.record;
        if (!stats.users[userId]) {
          stats.userCount += 1;
          stats.users[userId] = { unsubscribed: 0 };
        }
        stats.users[userId].unsubscribed += unsubCount;
        stats.globalUnsubscribed += unsubCount;
        stats.totalMailScanned = (stats.totalMailScanned || 0) + scannedCount;
        return fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Master-Key": API_KEY
          },
          body: JSON.stringify(stats)
        });
      })
      .then(() => fetchAndShowGlobalStats());
  }

  function fetchAndShowGlobalStats() {
    fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
      headers: { "X-Master-Key": API_KEY }
    })
      .then(res => res.json())
      .then(data => {
        const stats = data.record;
        document.getElementById('global-stats').textContent =
          `😊 Happy customers: ${stats.userCount} | 📬 Total unsubscribed: ${stats.globalUnsubscribed} | ✉️ Total mails scanned: ${stats.totalMailScanned}`;
      })
      .catch(() => {
        document.getElementById('global-stats').textContent = "Could not load stats.";
      });
  }

  // Handle OAuth2 token from URL hash
  const hash = window.location.hash.substr(1);
  const params = new URLSearchParams(hash);
  const urlToken = params.get('access_token');
  if (urlToken) {
    localStorage.setItem('gmailToken', urlToken);
    token = urlToken;
    window.location.hash = '';
  }

  // If token exists, fetch emails
  if (token) {
    loginButton.textContent = "Logout";
    resultsDiv.innerHTML = `<p>✅ Logged in. Fetching emails...</p>`;
    getUserEmail(token, (email) => {
      localStorage.setItem('userEmail', email);
      userEmail = email;
      updateStats(userEmail, 0, 0);
      fetchAndRenderEmails(token);
    });
  } else {
    unsubscribeButton.disabled = true;
    loadMoreButton.style.display = "none";
  }

  fetchAndShowGlobalStats();
});

function getSelectedLinks() {
  return JSON.parse(localStorage.getItem("selectedLinks") || "[]");
}
function setSelectedLinks(arr) {
  localStorage.setItem("selectedLinks", JSON.stringify(arr));
}

window.addEventListener("beforeunload", () => {
  localStorage.removeItem("selectedLinks");
  localStorage.setItem("adShownFor", "5");
  selectionLimit = 5;
});
