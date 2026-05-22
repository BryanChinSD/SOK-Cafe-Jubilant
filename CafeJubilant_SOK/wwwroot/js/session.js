async function getClientIP() {
    try {
        const res = await fetch("https://api.ipify.org?format=json");
        const data = await res.json();
        return data.ip || "Unknown";
    } catch {
        return "Unknown";
    }
}

function extractEssentialUserAgentInfo(userAgent) {
    if (!userAgent || userAgent === "Unknown") return "Unknown";

    const browserPatterns = [
        { name: "Chrome", pattern: /Chrome\/(\d+)/ },
        { name: "Firefox", pattern: /Firefox\/(\d+)/ },
        { name: "Safari", pattern: /Version\/(\d+).*Safari/ },
        { name: "Edge", pattern: /Edg\/(\d+)/ },
        { name: "Opera", pattern: /Opera\/(\d+)/ },
    ];

    for (const { name, pattern } of browserPatterns) {
        const match = userAgent.match(pattern);
        if (match) {
            return name + match[1];
        }
    }

    if (userAgent.includes("Windows")) return "Win";
    if (userAgent.includes("Mac")) return "Mac";
    if (userAgent.includes("Linux")) return "Linux";
    if (userAgent.includes("Android")) return "Android";
    if (userAgent.includes("iOS")) return "iOS";

    return "Unknown";
}

async function createDeviceFingerprint() {
    const userAgent = navigator.userAgent || "Unknown";
    const essentialUA = extractEssentialUserAgentInfo(userAgent);
    const ip = await getClientIP();

    const fingerprintData = {
        ua: essentialUA,
        ip,
        ts: Math.floor(Date.now() / 1000),
    };

    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(fingerprintData));
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return hashHex.substring(0, 30);
}

function createRandomSessionToken() {
    return [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
}

// Expose functions globally so you can call them from other scripts or inline
window.SessionUtils = {
    createDeviceFingerprint,
    createRandomSessionToken,
};
