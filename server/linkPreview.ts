
export async function fetchLinkPreview(tcoUrl: string) {
  try {
    let currentUrl = tcoUrl;
    let response;
    let hops = 0;

    // 1. Manually follow redirects
    while (hops < 5) {
      response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'
        }
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location) {
          currentUrl = new URL(location, currentUrl).href;
          hops++;
          continue;
        }
      }
      break;
    }

    if (!response) return null;
    const finalUrl = currentUrl;

    // Detect and skip non-media Twitter status
    const isTwitterStatus = finalUrl.includes('x.com/') && finalUrl.includes('/status/');
    const isTwitterMedia = /\/(photo|video)\/\d+/i.test(finalUrl);

    if (isTwitterStatus && !isTwitterMedia) {
      return null;
    }

    // 2. Fetch the page HTML with Discordbot UA
    const htmlResponse = await fetch(finalUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)' }
    });
    let html = await htmlResponse.text();

    const getTag = (prop: string) => {
      const regexes = [
        new RegExp(`<meta[^>]*property=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i'),
        new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${prop}["']`, 'i'),
        new RegExp(`<meta[^>]*name=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i')
      ];
      for (const regex of regexes) {
        const match = html.match(regex);
        if (match) return match[1];
      }
      return null;
    };

    let title = getTag('og:title') || getTag('twitter:title');
    let description = getTag('og:description') || getTag('twitter:description');
    let image = getTag('og:image') || getTag('twitter:image');

    // 3. Fallback to Microlink if scrape failed
    if (!title && !image) {
      try {
        const mres = await fetch(`https://api.microlink.io?url=${encodeURIComponent(finalUrl)}`);
        const mdata = await mres.json();
        if (mdata.status === 'success') {
          title = mdata.data.title;
          description = mdata.data.description;
          image = mdata.data.image?.url;
        }
      } catch (e) {
        console.warn(`[LinkPreview] Microlink fallback failed`);
      }
    }

    if (!title && !image) return null;

    return {
      url: finalUrl,
      image,
      title,
      description,
    };
  } catch (err) {
    console.error(`[LinkPreview] Failed:`, err);
    return null;
  }
}
