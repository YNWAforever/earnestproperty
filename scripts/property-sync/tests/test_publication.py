import unittest, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scraping.publication import publication_content

class PublicationContentTests(unittest.TestCase):
    def test_verified_gallery_and_fact_description(self):
        html='<div class="slider-block"><div class="ps-noscript-grid"><img src="https://i1.28hse.com/2026/a.jpg"><img src="https://i1.28hse.com/2026/a.jpg"></div></div>'
        result=publication_content(html, {'estate':'OMA OMA','saleable_area':'627','bedrooms':3,'floor':'低層'})
        self.assertEqual(result['images'], ['https://i1.28hse.com/2026/a.jpg'])
        self.assertIn('627', result['description'])
        self.assertNotIn('豪華', result['description'])
    def test_unknown_gallery_and_external_images_fail_closed(self):
        for html in ['<img src="https://i1.28hse.com/a.jpg">','<div class="slider-block"><div class="ps-noscript-grid"><img src="http://127.0.0.1/a.jpg"></div></div>']:
            self.assertEqual(publication_content(html, {'estate':'X','saleable_area':'500'})['images'], [])
    def test_missing_facts_never_invents_description(self):
        self.assertEqual(publication_content('', {})['description'], '')
