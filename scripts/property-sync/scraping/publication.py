"""Optional publication evidence from an already identity-validated detail page."""
from bs4 import BeautifulSoup
from urllib.parse import urlparse


def publication_content(html, record):
    gallery = BeautifulSoup(html, 'html.parser').select('.slider-block .ps-noscript-grid')
    images = list(dict.fromkeys(x['src'] for x in gallery[0].select('img[src]'))) if len(gallery) == 1 else []
    try:
        invalid = any(urlparse(x).scheme != 'https' or urlparse(x).hostname not in ('i1.28hse.com', 'i2.28hse.com', 'i3.28hse.com') or urlparse(x).username or urlparse(x).port for x in images)
    except ValueError:
        invalid = True
    if invalid:
        images = []
    facts = [record.get('estate'), record.get('floor')]
    if record.get('saleable_area'):
        facts.append(f"實用面積 {record['saleable_area']} 平方呎")
    for field, label in [('bedrooms', '房'), ('bathrooms', '浴室')]:
        if record.get(field) is not None:
            facts.append(f"{record[field]} {label}")
    description = '，'.join(str(x) for x in facts if x) + '。' if record.get('estate') and record.get('saleable_area') else ''
    return {'description': description, 'images': images[:6]}


def configured_publication_content(root, cfg):
    """Use only literal detail content with separately verified publication rights."""
    empty = {'description': '', 'images': []}
    policy = cfg.get('publication', {})
    if not isinstance(policy, dict) or any(policy.get(k) is not True for k in
        ('verified', 'rights_confirmed', 'media_hosts_verified')):
        return empty
    hosts = policy.get('allowed_media_hosts')
    if not isinstance(hosts, list) or not hosts or len(hosts) > 10:
        return empty
    desc_selector, images_selector = policy.get('description_selector'), policy.get('images_selector')
    if not isinstance(desc_selector, str) or not isinstance(images_selector, str):
        return empty
    try:
        descriptions = root.select(desc_selector)
        if len(descriptions) != 1:
            return empty
        description = descriptions[0].get_text(' ', strip=True)
        if not description or len(description) > 2000:
            return empty
        images = list(dict.fromkeys(x.get('src') for x in root.select(images_selector)))
        if not images or len(images) > 6:
            return empty
        for image in images:
            u = urlparse(image)
            if (not isinstance(image, str) or u.scheme != 'https' or u.hostname not in hosts
                or u.username or u.password or u.port or u.fragment):
                return empty
        return {'description': description, 'images': images}
    except (ValueError, TypeError):
        return empty
