"""
Lugeja - RSS ja Veebiuudiste parser ning kraapija
"""

import re
import datetime
import calendar
import socket
import ipaddress
from urllib.parse import urljoin, urlparse
import requests
import feedparser
from bs4 import BeautifulSoup

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'et-EE,et;q=0.9,en-US;q=0.8,en;q=0.7'
}

MAX_RESPONSE_BYTES = 8 * 1024 * 1024  # 8 MB limiit mälu kaitsmiseks

def is_safe_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Kontrollib, et IP-aadress ei oleks privaat-, link-local-, loopback- või eriotstarbeline."""
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return not (
        ip.is_private or
        ip.is_loopback or
        ip.is_link_local or
        ip.is_reserved or
        ip.is_multicast or
        ip.is_unspecified
    )

def is_safe_url(url: str) -> bool:
    """
    Kontrollib, et URL oleks turvaline: lubatud on ainult http/https protokoll
    ning sihtkoht ei tohi lahenduda lokaalsele või sisevõrgu IP-aadressile (SSRF kaitse).
    Kontrollib kõiki IPv4 ja IPv6 aadresse (sh DNS rebinding ja pilve metaandmed).
    """
    if not url or not isinstance(url, str):
        return False
    clean_url = url.strip()
    if not clean_url.startswith(('http://', 'https://')):
        clean_url = 'https://' + clean_url
    try:
        parsed = urlparse(clean_url)
        if parsed.scheme.lower() not in ('http', 'https'):
            return False
        hostname = parsed.hostname
        if not hostname:
            return False
        hostname_lower = hostname.lower().strip('.')
        if hostname_lower in ('localhost', 'metadata.google.internal', 'instance-data', '169.254.169.254'):
            return False
        if hostname_lower.endswith(('.local', '.internal', '.localhost')):
            return False

        # Lahendame ja kontrollime kõiki seotud IPv4 ja IPv6 aadresse
        addr_info = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
        if not addr_info:
            return False
        for _, _, _, _, sockaddr in addr_info:
            ip_str = sockaddr[0]
            ip = ipaddress.ip_address(ip_str)
            if not is_safe_ip(ip):
                return False
        return True
    except Exception:
        return False

def sanitize_article_url(link: str, base_url: str = '') -> str:
    """
    Tagab, et artikli URL kasutab rangelt http või https protokolli
    ning tõkestab pahatahtlikud javascript: või andmeskeemid.
    """
    if not link or not isinstance(link, str):
        return ''
    clean = link.strip()
    if clean.startswith('//'):
        clean = 'https:' + clean
    if base_url:
        clean = urljoin(base_url, clean)
    try:
        parsed = urlparse(clean)
        if parsed.scheme.lower() not in ('http', 'https'):
            return ''
        return clean
    except Exception:
        return ''

def sanitize_image_url(link: str, base_url: str = '') -> str:
    """
    Tagab, et pildi URL kasutab rangelt http/https või ohutut data:image protokolli.
    """
    if not link or not isinstance(link, str):
        return ''
    clean = link.strip()
    if clean.lower().startswith('data:image/'):
        # Lubame ainult ohutud rastervormingud, keelame SVG jm potentsiaalselt XSS-ohtlikud data-skeemid
        if re.match(r'^data:image/(?:png|jpeg|jpg|gif|webp);base64,', clean, re.IGNORECASE):
            return clean
        return ''
    if clean.startswith('//'):
        clean = 'https:' + clean
    if base_url:
        clean = urljoin(base_url, clean)
    try:
        parsed = urlparse(clean)
        if parsed.scheme.lower() not in ('http', 'https'):
            return ''
        return clean
    except Exception:
        return ''

def safe_http_get(url: str, timeout: int = 7, max_redirects: int = 3):
    """
    Teeb turvalise GET-päringu, kontrollides SSRF-i (sh ümbersuunamised) ning piirates voo mahtu (DoS kaitse).
    Tagastab (content_bytes, encoding, content_type).
    """
    current_url = url
    for _ in range(max_redirects + 1):
        if not is_safe_url(current_url):
            raise ValueError(f"Lubamatu või sisevõrgu aadress: {current_url}")
        
        resp = requests.get(current_url, headers=HEADERS, timeout=timeout, stream=True, allow_redirects=False)
        try:
            if resp.is_redirect or resp.status_code in (301, 302, 303, 307, 308):
                location = resp.headers.get('Location')
                if not location:
                    raise ValueError("Ümbersuunamisel puudub Location päis")
                current_url = urljoin(current_url, location)
                continue

            resp.raise_for_status()
            content = bytearray()
            for chunk in resp.iter_content(chunk_size=32768):
                content.extend(chunk)
                if len(content) > MAX_RESPONSE_BYTES:
                    raise ValueError("Vastus ületas maksimaalse lubatud mahu (8 MB)")
            encoding = resp.encoding or 'utf-8'
            content_type = resp.headers.get('Content-Type', '').lower()
            return bytes(content), encoding, content_type
        finally:
            resp.close()

    raise ValueError("Liiga palju ümbersuunamisi (redirect loop)")


# Tuntud mitte-uudiste lingid mida kraapimisel ignoreerida
IGNORE_PATTERNS = [
    r'/logi-sisse', r'/login', r'/telli', r'/kontakt', r'/reklaam', r'/privaatsus',
    r'/tingimused', r'/search', r'/otsing', r'/autor/', r'/kategooria/', r'/tag/',
    r'facebook\.com', r'twitter\.com', r'instagram\.com', r'linkedin\.com'
]

def clean_text(text):
    if not text:
        return ""
    if isinstance(text, dict):
        text = text.get('value') or text.get('text') or ''
    if not isinstance(text, str):
        text = str(text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def parse_published_time(entry, default_now=None):
    """
    Teisendab feedparseri UTC ajatempli kohaliku ajatsooni kuupäevaks ja kellaajaks (YYYY-MM-DD HH:MM:SS).
    """
    if default_now is None:
        default_now = datetime.datetime.now()

    time_tuple = None
    if hasattr(entry, 'published_parsed') and entry.published_parsed:
        time_tuple = entry.published_parsed
    elif hasattr(entry, 'updated_parsed') and entry.updated_parsed:
        time_tuple = entry.updated_parsed

    if time_tuple:
        try:
            # feedparseri time_tuple on ALATI UTC ajas.
            # calendar.timegm teeb sellest korrektse UTC timestampi,
            # ja datetime.fromtimestamp konverteerib selle kohalikuks ajaks.
            utc_timestamp = calendar.timegm(time_tuple)
            local_dt = datetime.datetime.fromtimestamp(utc_timestamp)
            return local_dt.strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            pass

    return default_now.strftime("%Y-%m-%d %H:%M:%S")

def extract_image_from_entry(entry):
    """
    Otsib feedi kirjest pildi URL-i:
    - media_content (image tüüp või medium=image)
    - media_thumbnail
    - enclosures (type image/* või pildilaiend)
    - links (rel=enclosure või image tüüp)
    - entry.image
    - Kirjeldusest/sisust <img> tag
    """
    # 1. media_content
    if hasattr(entry, 'media_content') and entry.media_content:
        for media in entry.media_content:
            u = media.get('url')
            if u:
                m_type = media.get('type', '').lower()
                m_medium = media.get('medium', '').lower()
                if m_medium == 'image' or m_type.startswith('image/') or not m_medium:
                    return u

    # 2. media_thumbnail
    if hasattr(entry, 'media_thumbnail') and entry.media_thumbnail:
        for thumb in entry.media_thumbnail:
            if thumb.get('url'):
                return thumb.get('url')

    # 3. enclosures
    if hasattr(entry, 'enclosures') and entry.enclosures:
        for enc in entry.enclosures:
            href = enc.get('href', '')
            enc_type = enc.get('type', '').lower()
            if href:
                if enc_type.startswith('image/') or any(href.lower().split('?')[0].endswith(ext) for ext in ['.jpg', '.jpeg', '.png', '.webp', '.gif']):
                    return href

    # 4. links rel="enclosure"
    if hasattr(entry, 'links') and entry.links:
        for link in entry.links:
            href = link.get('href', '')
            rel = link.get('rel', '')
            l_type = link.get('type', '').lower()
            if href and (rel == 'enclosure' or l_type.startswith('image/')):
                return href
            if href and any(href.lower().split('?')[0].endswith(ext) for ext in ['.jpg', '.jpeg', '.png', '.webp', '.gif']):
                return href

    # 5. entry.image
    if hasattr(entry, 'image') and entry.image:
        if isinstance(entry.image, dict) and entry.image.get('href'):
            return entry.image.get('href')
        elif isinstance(entry.image, str):
            return entry.image

    # 6. Kirjeldusest või sisust <img> tag
    content_html = ""
    if hasattr(entry, 'content') and entry.content:
        content_html = entry.content[0].value
    elif hasattr(entry, 'summary') and entry.summary:
        content_html = entry.summary
    elif hasattr(entry, 'description') and entry.description:
        content_html = entry.description

    if content_html:
        soup = BeautifulSoup(content_html, 'html.parser')
        og_img = soup.find('meta', property=lambda p: p and p.lower() in ('og:image', 'twitter:image'))
        if not og_img:
            og_img = soup.find('meta', attrs={'name': lambda n: n and n.lower() in ('og:image', 'twitter:image')})
        if og_img and og_img.get('content'):
            return og_img.get('content').strip()

        for img in soup.find_all('img'):
            src = img.get('src') or img.get('data-src') or img.get('data-original')
            if src:
                src = src.strip()
                if any(bad in src.lower() for bad in ['1x1', 'pixel', 'tracker', 'data:image']):
                    continue
                return src

    return None

def find_image_for_card(a_tag, base_url):
    """
    Otsib artikli kaardist või selle ümbrusest pildi (img src, data-src, srcset jne).
    Liigub mööda esivanemaid kuni 5 taset ülespoole.
    """
    if not a_tag:
        return None

    curr = a_tag
    for _ in range(5):
        curr = curr.parent
        if not curr or curr.name == '[document]':
            break

        # 1. Otsi img tage
        for img in curr.find_all('img'):
            src = (
                img.get('src') or
                img.get('data-src') or
                img.get('data-original') or
                img.get('data-lazy-src') or
                img.get('data-hi-res-src')
            )
            # Kui on srcset, võta esimene URL
            if not src and img.get('srcset'):
                parts = img.get('srcset').split(',')
                if parts:
                    src = parts[0].strip().split(' ')[0]

            if src:
                src = src.strip()
                if any(bad in src.lower() for bad in ['data:image', 'spacer.gif', 'blank.gif', '1x1', 'pixel.gif', 'favicon']):
                    continue
                return urljoin(base_url, src)

        # 2. Otsi picture > source elemente
        for source in curr.find_all('source'):
            srcset = source.get('srcset')
            if srcset:
                src = srcset.split(',')[0].strip().split(' ')[0]
                if src and not src.startswith('data:'):
                    return urljoin(base_url, src)

        # Kui oleme jõudnud <article> sildini, lõpetame otsingu
        if curr.name == 'article':
            break

    return None

def discover_source(url):
    """
    Tuvastab URL-i põhjal nime, logo/faviconi ja kas lehel on RSS voog.
    """
    url = url.strip()
    if not url.startswith('http://') and not url.startswith('https://'):
        url = 'https://' + url

    parsed = urlparse(url)
    domain = parsed.netloc.replace('www.', '')

    # Esialgne nimi domeeni järgi
    name_parts = domain.split('.')
    default_name = name_parts[0].capitalize() if name_parts else domain

    logo_url = f"https://www.google.com/s2/favicons?domain={domain}&sz=64"
    is_rss = False
    rss_url = url

    if not is_safe_url(url):
        return {'name': default_name, 'url': url, 'is_rss': False, 'logo_url': logo_url}

    try:
        raw_bytes, encoding, content_type = safe_http_get(url, timeout=10)

        # Kontrollime kas on otse RSS/XML
        if 'xml' in content_type or 'rss' in content_type:
            feed = feedparser.parse(raw_bytes)
            if feed.entries or feed.feed.get('title'):
                is_rss = True
                name = feed.feed.get('title') or default_name
                return {
                    'name': name.strip(),
                    'url': url,
                    'is_rss': True,
                    'logo_url': logo_url
                }

        # Kui oli tavaline HTML, otsime pealkirja, faviconi ja alternate RSS linke
        html_text = raw_bytes.decode(encoding, errors='replace')
        soup = BeautifulSoup(html_text, 'html.parser')
        
        # Lehe pealkiri
        title_tag = soup.find('title')
        if title_tag and title_tag.string:
            title_text = title_tag.string.strip()
            # Puhasta tiitlist tüüpilised lisad
            title_clean = re.split(r'[-–|•:]', title_text)[0].strip()
            if title_clean and len(title_clean) < 40:
                default_name = title_clean

        # Otsi faviconi
        icon_link = soup.find('link', rel=lambda r: r and ('icon' in r.lower() or 'shortcut' in r.lower()))
        if icon_link and icon_link.get('href'):
            logo_url = urljoin(url, icon_link['href'])

        # Otsi alternate RSS voogu
        alt_feed = soup.find('link', type=lambda t: t and ('rss' in t or 'atom' in t or 'xml' in t))
        if alt_feed and alt_feed.get('href'):
            candidate_rss = urljoin(url, alt_feed['href'])
            if is_safe_url(candidate_rss):
                try:
                    cand_bytes, _, _ = safe_http_get(candidate_rss, timeout=6)
                    fp = feedparser.parse(cand_bytes)
                    if fp.entries:
                        is_rss = True
                        rss_url = candidate_rss
                except Exception:
                    pass

    except Exception as e:
        print(f"Hoiatus allika avastamisel ({url}): {e}")

    return {
        'name': default_name,
        'url': rss_url if is_rss else url,
        'is_rss': is_rss,
        'logo_url': logo_url
    }

def scrape_articles_from_html(soup, base_url):
    """
    Parsib tavaliselt HTML lehelt uudisartiklite pealkirjad, lingid ja pildid.
    Spetsiaalne loogika Eesti ja tuntud meediaväljaannete jaoks + universaalne heuristika.
    """
    articles = []
    seen_urls = set()
    now_dt = datetime.datetime.now()

    domain = urlparse(base_url).netloc.lower()

    # 1. DELFI spetsiifiline käsitlus
    if 'delfi.ee' in domain:
        for a in soup.find_all('a', href=True):
            href = a['href']
            text = clean_text(a.get_text())
            if '/artikkel/' in href and len(text) > 15:
                clean_url = sanitize_article_url(href.split('?')[0], base_url)
                if not clean_url or clean_url in seen_urls:
                    continue
                seen_urls.add(clean_url)

                img_url = sanitize_image_url(find_image_for_card(a, base_url), base_url)

                articles.append({
                    'title': text,
                    'url': clean_url,
                    'image_url': img_url,
                    'published_at': now_dt.strftime("%Y-%m-%d %H:%M:%S")
                })
        if articles:
            return articles

    # 2. ÄRIPÄEV spetsiifiline käsitlus
    if 'aripaev.ee' in domain:
        for a in soup.find_all('a', href=True):
            href = a['href']
            text = clean_text(a.get_text())
            is_aripaev_article = any(p in href for p in ['/uudised/', '/borsiuudised/', '/arvamused/', '/raadiosaated/'])
            if is_aripaev_article and len(text) > 18:
                clean_url = sanitize_article_url(href.split('?')[0], base_url)
                if not clean_url or clean_url in seen_urls:
                    continue
                seen_urls.add(clean_url)

                img_url = sanitize_image_url(find_image_for_card(a, base_url), base_url)

                articles.append({
                    'title': text,
                    'url': clean_url,
                    'image_url': img_url,
                    'published_at': now_dt.strftime("%Y-%m-%d %H:%M:%S")
                })
        if articles:
            return articles

    # 3. ERR spetsiifiline käsitlus
    if 'err.ee' in domain:
        for a in soup.find_all('a', href=True):
            href = a['href']
            text = clean_text(a.get_text())
            # ERR artiklite URL-id sisaldavad numbrilist ID-d nt /1610148367/
            has_id = bool(re.search(r'/\d{7,12}/', href))
            if has_id and len(text) > 15:
                clean_url = sanitize_article_url(href.split('?')[0], base_url)
                if not clean_url or clean_url in seen_urls:
                    continue
                seen_urls.add(clean_url)

                img_url = sanitize_image_url(find_image_for_card(a, base_url), base_url)

                articles.append({
                    'title': text,
                    'url': clean_url,
                    'image_url': img_url,
                    'published_at': now_dt.strftime("%Y-%m-%d %H:%M:%S")
                })
        if articles:
            return articles

    # 4. Universaalne kraapimine lehe struktuuri järgi
    candidates = []

    # Otsi esmalt article elemente
    for art in soup.find_all(['article', 'div']):
        # Kui klassis on news, story, post, item
        classes = " ".join(art.get('class', []))
        if any(w in classes.lower() for w in ['news', 'article', 'post', 'item', 'story', 'entry']):
            for heading in art.find_all(['h1', 'h2', 'h3', 'h4', 'a']):
                if heading.name == 'a' and heading.get('href'):
                    candidates.append((heading, art))
                else:
                    a = heading.find('a', href=True)
                    if a:
                        candidates.append((a, art))

    # Kui article elementidest ei leitud piisavalt, otsi kõiki h1-h4 linke
    if len(candidates) < 5:
        for heading in soup.find_all(['h1', 'h2', 'h3', 'h4']):
            a = heading.find('a', href=True)
            if a:
                candidates.append((a, heading.parent))

    for a_tag, parent_el in candidates:
        href = a_tag.get('href')
        if not href or href.startswith('#') or href.startswith('javascript:'):
            continue

        clean_url = sanitize_article_url(href.split('?')[0], base_url)
        if not clean_url or clean_url in seen_urls:
            continue

        # Kontrolli kas URL on ignoreeritav
        if any(re.search(pat, clean_url, re.IGNORECASE) for pat in IGNORE_PATTERNS):
            continue

        title = clean_text(a_tag.get_text())
        if len(title) < 18 or len(title) > 300:
            continue

        img_url = sanitize_image_url(find_image_for_card(a_tag, base_url), base_url)

        seen_urls.add(clean_url)
        articles.append({
            'title': title,
            'url': clean_url,
            'image_url': img_url,
            'published_at': now_dt.strftime("%Y-%m-%d %H:%M:%S")
        })

    return articles

def fetch_articles(source_url, is_rss=True):
    """
    Põhifunktsioon: toob allika artiklid, toetades nii RSS-i kui ka HTML kraapimist.
    Tagastab loendi sõnastikest:
    [{ 'title': str, 'url': str, 'image_url': str, 'published_at': str }]
    """
    articles = []

    try:
        raw_bytes, encoding, _ = safe_http_get(source_url, timeout=7)

        # Kui märgitud või tundub olevat RSS/XML
        feed = feedparser.parse(raw_bytes)
        if feed.entries:
            for entry in feed.entries:
                title = clean_text(getattr(entry, 'title', ''))
                link = getattr(entry, 'link', '')
                if not title or not link:
                    continue

                full_link = sanitize_article_url(link, source_url)
                if not full_link:
                    continue
                img = sanitize_image_url(extract_image_from_entry(entry), source_url)
                pub_date = parse_published_time(entry)

                articles.append({
                    'title': title,
                    'url': full_link,
                    'image_url': img,
                    'published_at': pub_date
                })
            return articles

        # Kui feedparser ei leidnud kirjeid, siis on tavaline veebileht
        html_text = raw_bytes.decode(encoding, errors='replace')
        soup = BeautifulSoup(html_text, 'html.parser')

        # Kontrolli kas lehel on alternate RSS
        alt_link = soup.find('link', type=lambda t: t and ('rss' in t or 'atom' in t or 'xml' in t))
        if alt_link and alt_link.get('href'):
            rss_candidate = sanitize_article_url(alt_link['href'], source_url)
            if rss_candidate and is_safe_url(rss_candidate):
                try:
                    sub_bytes, _, _ = safe_http_get(rss_candidate, timeout=5)
                    sub_feed = feedparser.parse(sub_bytes)
                    if sub_feed.entries:
                        for entry in sub_feed.entries:
                            title = clean_text(getattr(entry, 'title', ''))
                            link = getattr(entry, 'link', '')
                            if not title or not link:
                                continue
                            full_link = sanitize_article_url(link, rss_candidate)
                            if not full_link:
                                continue
                            cand_img = sanitize_image_url(extract_image_from_entry(entry), rss_candidate)
                            articles.append({
                                'title': title,
                                'url': full_link,
                                'image_url': cand_img,
                                'published_at': parse_published_time(entry)
                            })
                        return articles
                except Exception:
                    pass

        # Kraabi HTML-ist
        articles = scrape_articles_from_html(soup, source_url)

    except Exception as e:
        print(f"Viga artiklite toomisel ({source_url}): {e}")

    return articles
