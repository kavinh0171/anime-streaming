const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('./logger');

const BASE_DELAY = parseInt(process.env.REQUEST_DELAY_MS || '1500');
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3');

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetch(url, options = {}) {
  const { headers = {}, referer, retry = 0, parseHtml = true } = options;
  try {
    const resp = await axios.get(url, {
      headers: { ...BASE_HEADERS, ...headers, ...(referer ? { Referer: referer } : {}) },
      timeout: 15000,
      maxRedirects: 5,
    });
    await sleep(BASE_DELAY + Math.random() * 500);
    return parseHtml ? cheerio.load(resp.data) : resp.data;
  } catch (err) {
    if (retry < MAX_RETRIES) {
      const backoff = (retry + 1) * 3000;
      logger.warn(`Retry ${retry + 1}/${MAX_RETRIES} for ${url} after ${backoff}ms: ${err.message}`);
      await sleep(backoff);
      return fetch(url, { ...options, retry: retry + 1 });
    }
    throw err;
  }
}

async function post(url, body, options = {}) {
  const { headers = {}, referer, retry = 0 } = options;
  try {
    const resp = await axios.post(url, body, {
      headers: { ...BASE_HEADERS, ...headers, ...(referer ? { Referer: referer } : {}) },
      timeout: 15000,
    });
    await sleep(BASE_DELAY + Math.random() * 500);
    return resp.data;
  } catch (err) {
    if (retry < MAX_RETRIES) {
      const backoff = (retry + 1) * 3000;
      logger.warn(`Retry ${retry + 1}/${MAX_RETRIES} POST ${url} after ${backoff}ms: ${err.message}`);
      await sleep(backoff);
      return post(url, body, { ...options, retry: retry + 1 });
    }
    throw err;
  }
}

module.exports = { fetch, post, sleep };
