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
