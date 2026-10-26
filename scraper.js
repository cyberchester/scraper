import axios from 'axios';
import moment from 'moment-timezone';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const homeUrl = 'https://www.set.or.th/th/home';
const apiUrl = 'https://www.set.or.th/api/set/index/info/list?type=INDEX';
const cookieJar = new Map();
const cookieRefreshMs = 10 * 60 * 1000;
const requestTimeoutMs = 15_000;
const userAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

function convertThaiToMyanmarTime(thaiTime) {
    const format24Hour = 'DD/MM/YYYY HH:mm:ss';
    const format12Hour = 'DD/MM/YYYY hh:mm:ss A';

    let thaiMoment = moment.parseZone(thaiTime, moment.ISO_8601, true);
    if (!thaiMoment.isValid()) {
        thaiMoment = moment.tz(thaiTime, format24Hour, true, 'Asia/Bangkok');
    }

    return thaiMoment.clone().tz('Asia/Yangon').format(format12Hour);
}

function saveResponseCookies(response) {
    const setCookieHeaders = response.headers['set-cookie'] || [];

    for (const setCookie of setCookieHeaders) {
        const [cookiePair, ...attributes] = setCookie.split(';');
        const separator = cookiePair.indexOf('=');
        if (separator < 1) continue;

        const name = cookiePair.slice(0, separator).trim();
        const value = cookiePair.slice(separator + 1).trim();
        const maxAge = attributes.find((attribute) => /^\s*max-age=/i.test(attribute));
        const expires = attributes.find((attribute) => /^\s*expires=/i.test(attribute));

        if (maxAge) {
            const seconds = Number(maxAge.split('=')[1]);
            if (Number.isFinite(seconds) && seconds <= 0) {
                cookieJar.delete(name);
                continue;
            }
            cookieJar.set(name, {
                value,
                expiresAt: Number.isFinite(seconds) ? Date.now() + seconds * 1000 : null,
            });
        } else {
            const expiresAt = expires ? Date.parse(expires.split('=').slice(1).join('=').trim()) : null;
            if (expiresAt !== null && Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
                cookieJar.delete(name);
            } else {
                cookieJar.set(name, { value, expiresAt });
            }
        }
    }
}

function getCookieHeader() {
    const now = Date.now();
    const pairs = [];

    for (const [name, cookie] of cookieJar) {
        if (cookie.expiresAt !== null && cookie.expiresAt <= now) {
            cookieJar.delete(name);
            continue;
        }
        pairs.push(`${name}=${cookie.value}`);
    }

    return pairs.join('; ');
}

let homeCookiesLoadedAt = 0;
let homeRequestPromise = null;

async function loadHomeCookies(force = false) {
    if (!force && Date.now() - homeCookiesLoadedAt < cookieRefreshMs) {
        return;
    }
    if (homeRequestPromise) {
        return homeRequestPromise;
    }

    homeRequestPromise = (async () => {
        const response = await axios.get(homeUrl, {
            headers: {
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9,th;q=0.8',
                'User-Agent': userAgent,
            },
            timeout: requestTimeoutMs,
        });
        saveResponseCookies(response);
        homeCookiesLoadedAt = Date.now();
    })().finally(() => {
        homeRequestPromise = null;
    });

    return homeRequestPromise;
}

const scrapeCache = {
    timestamp: 0,
    data: null,
    promise: null,
};

async function fetchMarketData() {
    await loadHomeCookies();

    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const cookie = getCookieHeader();
            const response = await axios.get(apiUrl, {
                headers: {
                    Accept: 'application/json, text/plain, */*',
                    'Accept-Language': 'en-US,en;q=0.9,th;q=0.8',
                    Referer: homeUrl,
                    'User-Agent': userAgent,
                    ...(cookie ? { Cookie: cookie } : {}),
                },
                timeout: requestTimeoutMs,
            });
            saveResponseCookies(response);

            if (Array.isArray(response.data?.indexIndustrySectors)) {
                return response.data;
            }

            if (attempt === 0) {
                await loadHomeCookies(true);
                continue;
            }
            throw new Error('Set.or.th API response did not contain market index data');
        } catch (error) {
            const status = error.response?.status;
            if (attempt === 0 && (status === 401 || status === 403 || !status)) {
                await loadHomeCookies(true);
                continue;
            }
            throw error;
        }
    }
}

const getData = async function() {
    const now = Date.now();
    if (scrapeCache.data && now - scrapeCache.timestamp < 1000) {
        return scrapeCache.data;
    }
    if (scrapeCache.promise) {
        return scrapeCache.promise;
    }

    scrapeCache.promise = (async () => {
        try {
            const apiData = await fetchMarketData();
            const index = apiData.indexIndustrySectors[0];
            const set = Number(index.last).toFixed(2);
            const value = (Number(index.value) / 1_000_000).toFixed(2);

            const result = {
                serverTime: convertThaiToMyanmarTime(index.marketDateTime),
                marketStatus: index.marketStatus,
                set,
                value,
                digit: set.split('.')[1][1] + value.split('.')[0].slice(-1),
                high: index.high,
                low: index.low,
                open: index.prior,
            };

            scrapeCache.data = result;
            scrapeCache.timestamp = Date.now();
            return result;
        } catch (error) {
            console.error('Set.or.th scraper request failed:', error.response?.status || error.message);
            return null;
        } finally {
            scrapeCache.promise = null;
        }
    })();

    return scrapeCache.promise;
};

export default { getData };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    console.log(await getData());
}
