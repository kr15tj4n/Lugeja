#!/usr/bin/env python3
"""
Lugeja - Põhjalik automatiseeritud testikomplekt (Unit, Integration & Regression)
Käivitamine: python3 -m unittest tests/test_lugeja_suite.py
"""

import os
import sys
import tempfile
import unittest
import json
import re
from io import BytesIO
from unittest.mock import patch, MagicMock

# Lisame projekti juurkausta otsinguteesse
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

import lugeja
import parser


class BaseLugejaTestCase(unittest.TestCase):
    """Baasklass isoleeritud SQLite testandmebaasi ja Flask testkliendiga."""

    def setUp(self):
        self.db_fd, self.db_path = tempfile.mkstemp(suffix='.db')
        lugeja.app.config['DATABASE'] = self.db_path
        lugeja.app.config['TESTING'] = True
        lugeja.app.config['SESSION_COOKIE_SECURE'] = False
        lugeja.IS_TURSO = False
        
        # Tühjendame kiiruspiirangud enne iga testi
        with lugeja.RATE_LIMIT_LOCK:
            lugeja.AUTH_RATE_LIMITS.clear()

        # Initsialiseerime puhta andmebaasi skeemi
        lugeja.init_db()
        self.client = lugeja.app.test_client()

    def tearDown(self):
        try:
            os.close(self.db_fd)
            if os.path.exists(self.db_path):
                os.unlink(self.db_path)
        except Exception:
            pass

    def register_user(self, username="testuser", password="Password123!", email="test@lugeja.app"):
        return self.client.post('/api/auth/register', json={
            'username': username,
            'password': password,
            'email': email
        })

    def login_user(self, username="testuser", password="Password123!"):
        return self.client.post('/api/auth/login', json={
            'username': username,
            'password': password
        })


class TestAuthAndSessions(BaseLugejaTestCase):
    """Autentimise ja seansihalduse testid."""

    def test_01_unauthenticated_me(self):
        res = self.client.get('/api/auth/me')
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertFalse(data['authenticated'])
        self.assertIsNone(data['user'])
        self.assertFalse(data['has_users'])

    def test_02_register_validation(self):
        # Liiga lühike kasutajanimi
        res = self.register_user(username="ab")
        self.assertEqual(res.status_code, 400)
        # Keelatud sümbolid
        res = self.register_user(username="user<script>")
        self.assertEqual(res.status_code, 400)
        # Liiga lühike salasõna
        res = self.register_user(username="validuser", password="123")
        self.assertEqual(res.status_code, 400)
        # Vigane e-post
        res = self.register_user(username="validuser", email="vigane-email")
        self.assertEqual(res.status_code, 400)

    def test_03_first_user_is_admin_and_second_is_regular(self):
        res1 = self.register_user(username="adminuser")
        self.assertEqual(res1.status_code, 201)
        data1 = res1.get_json()
        self.assertTrue(data1['user']['is_admin'])

        self.client.post('/api/auth/logout')

        res2 = self.register_user(username="regularuser", email="regular@lugeja.app")
        self.assertEqual(res2.status_code, 201)
        data2 = res2.get_json()
        self.assertFalse(data2['user']['is_admin'])

    def test_04_duplicate_username_and_email_nocase(self):
        self.register_user(username="Peeter", email="peeter@lugeja.app")
        self.client.post('/api/auth/logout')

        # Tõstutundetu duplikaat kasutajanimi
        res = self.register_user(username="peeter", email="muu@lugeja.app")
        self.assertEqual(res.status_code, 400)

        # Tõstutundetu duplikaat e-post
        res2 = self.register_user(username="peeter2", email="PEETER@lugeja.app")
        self.assertEqual(res2.status_code, 400)

    def test_05_login_and_logout_flow(self):
        self.register_user(username="mari", password="SecretPassword123!")
        self.client.post('/api/auth/logout')

        # Vale parool
        res_fail = self.login_user(username="mari", password="WrongPassword")
        self.assertEqual(res_fail.status_code, 401)

        # Õige parool
        res_ok = self.login_user(username="mari", password="SecretPassword123!")
        self.assertEqual(res_ok.status_code, 200)

        # Kontrollime /api/auth/me
        me_res = self.client.get('/api/auth/me')
        self.assertTrue(me_res.get_json()['authenticated'])
        self.assertEqual(me_res.get_json()['user']['username'], 'mari')

        # Logi välja
        logout_res = self.client.post('/api/auth/logout')
        self.assertEqual(logout_res.status_code, 200)
        me_after = self.client.get('/api/auth/me')
        self.assertFalse(me_after.get_json()['authenticated'])

    def test_06_password_reset_flow(self):
        self.register_user(username="kalle", password="OldPassword123!", email="kalle@lugeja.app")
        self.client.post('/api/auth/logout')

        # Taotleme parooli taastamist
        res = self.client.post('/api/auth/forgot-password', json={'identifier': 'kalle'})
        self.assertEqual(res.status_code, 200)

        # Leiame baasist genereeritud tokeni räsi
        conn = lugeja.get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT id, user_id, token_hash FROM password_resets ORDER BY id DESC LIMIT 1")
        row = cur.fetchone()
        conn.close()
        self.assertIsNotNone(row)

        # Seame teadaoleva tokeni räsi testimiseks
        raw_test_token = "test_raw_token_xyz"
        import hashlib
        simulated_hash = hashlib.sha256(raw_test_token.encode('utf-8')).hexdigest()

        conn = lugeja.get_db_connection()
        conn.cursor().execute("UPDATE password_resets SET token_hash = ? WHERE id = ?", (simulated_hash, row['id']))
        conn.commit()
        conn.close()

        # Teostame parooli uuendamise
        reset_res = self.client.post('/api/auth/reset-password', json={
            'token': raw_test_token,
            'new_password': 'NewPassword123!'
        })
        self.assertEqual(reset_res.status_code, 200)

        # Kontrollime, et vana parooliga enam sisse ei saa
        self.assertEqual(self.login_user(username="kalle", password="OldPassword123!").status_code, 401)
        # Uue parooliga sisselogimine õnnestub
        self.assertEqual(self.login_user(username="kalle", password="NewPassword123!").status_code, 200)

        # Tokeni taaskasutuse tõkestamine
        replay_res = self.client.post('/api/auth/reset-password', json={
            'token': raw_test_token,
            'new_password': 'AnotherPassword123!'
        })
        self.assertEqual(replay_res.status_code, 400)

    def test_07_delete_account_admin_protection(self):
        self.register_user(username="first_admin")
        del_res = self.client.post('/api/auth/delete-account')
        self.assertEqual(del_res.status_code, 403)
        self.assertIn('Peakasutaja', del_res.get_json()['error'])

    def test_08_delete_regular_account_cascade(self):
        self.register_user(username="admin_acc")
        self.client.post('/api/auth/logout')

        self.register_user(username="temp_user", email="temp@lugeja.app")
        # Lisame kategooria
        cat_res = self.client.post('/api/categories', json={'name': 'Ajutine kat'})
        cat_id = cat_res.get_json()['category']['id']
        
        with patch('parser.discover_source', return_value={'name': 'Test allikas', 'url': 'https://example.com/rss', 'is_rss': True, 'logo_url': None}), \
             patch('lugeja.refresh_all_sources', return_value=0):
            src_res = self.client.post('/api/sources', json={'name': 'Test allikas', 'url': 'https://example.com/rss', 'category_id': cat_id})
            self.assertEqual(src_res.status_code, 201)

        # Kustutame tavakonto
        del_res = self.client.post('/api/auth/delete-account')
        self.assertEqual(del_res.status_code, 200)

        # Veendume, et kasutaja ja tema andmed on andmebaasist eemaldatud
        conn = lugeja.get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM users WHERE username = 'temp_user'")
        self.assertEqual(cur.fetchone()[0], 0)
        cur.execute("SELECT COUNT(*) FROM categories WHERE name = 'Ajutine kat'")
        self.assertEqual(cur.fetchone()[0], 0)
        conn.close()


class TestUserStats(BaseLugejaTestCase):
    """Kasutaja statistika paneeli ja seadmetuvastuse testid."""

    def setUp(self):
        super().setUp()
        self.register_user(username="stats_user")

    def test_01_stats_structure_and_zero_state(self):
        res = self.client.get('/api/user/stats')
        self.assertEqual(res.status_code, 200)
        stats = res.get_json()

        expected_fields = [
            'account_age_days', 'account_age_text', 'opened_count',
            'read_rate_percent', 'scrolled_read_count', 'total_articles',
            'sources_count', 'categories_count', 'most_active_source',
            'favorite_source', 'device_stats'
        ]
        for field in expected_fields:
            self.assertIn(field, stats, f"Statistika vastusest puudub väli {field}")

        self.assertEqual(stats['sources_count'], 0)
        self.assertEqual(stats['categories_count'], 0)
        self.assertEqual(stats['opened_count'], 0)
        self.assertEqual(stats['scrolled_read_count'], 0)

    def test_02_stats_sources_and_categories_counts(self):
        # Loome 2 kategooriat
        self.client.post('/api/categories', json={'name': 'Kat 1'})
        self.client.post('/api/categories', json={'name': 'Kat 2'})

        # Loome 3 allikat mockitud parseriga
        mock_meta = lambda name, url: {'name': name, 'url': url, 'is_rss': True, 'logo_url': None}
        with patch('parser.discover_source', side_effect=lambda u: mock_meta('Src', u)), \
             patch('lugeja.refresh_all_sources', return_value=0):
            self.client.post('/api/sources', json={'name': 'Src 1', 'url': 'https://s1.ee/rss'})
            self.client.post('/api/sources', json={'name': 'Src 2', 'url': 'https://s2.ee/rss'})
            self.client.post('/api/sources', json={'name': 'Src 3', 'url': 'https://s3.ee/rss'})

        res = self.client.get('/api/user/stats')
        stats = res.get_json()
        self.assertEqual(stats['categories_count'], 2)
        self.assertEqual(stats['sources_count'], 3)

    def test_03_device_stats_recording(self):
        # Salvestame seadmed
        self.client.post('/api/user/device', json={'device': 'mobile'})
        self.client.post('/api/user/device', json={'device': 'mobile'})
        self.client.post('/api/user/device', json={'device': 'desktop'})

        res = self.client.get('/api/user/stats')
        dev = res.get_json()['device_stats']
        self.assertEqual(dev['mobile_count'], 2)
        self.assertEqual(dev['desktop_count'], 1)
        self.assertEqual(dev['dominant'], 'mobile')
        self.assertEqual(dev['mobile_percent'], 67)
        self.assertEqual(dev['desktop_percent'], 33)


class TestSourcesAndCategoriesCRUD(BaseLugejaTestCase):
    """Allikate ja kategooriate halduse testid."""

    def setUp(self):
        super().setUp()
        self.register_user(username="crud_user")

    def test_01_categories_crud(self):
        # 1. Lisa kategooria
        res = self.client.post('/api/categories', json={'name': 'Majandus'})
        self.assertEqual(res.status_code, 201)
        cat_id = res.get_json()['category']['id']

        # 2. Duplikaadi lisamine ebaõnnestub
        dup = self.client.post('/api/categories', json={'name': 'Majandus'})
        self.assertEqual(dup.status_code, 400)

        # 3. Muuda nime
        put_res = self.client.put(f'/api/categories/{cat_id}', json={'name': 'Raha & Majandus'})
        self.assertEqual(put_res.status_code, 200)

        # 4. Kustuta kategooria
        del_res = self.client.delete(f'/api/categories/{cat_id}')
        self.assertEqual(del_res.status_code, 200)

    def test_02_sources_ssrf_protection(self):
        # Sisevõrgu aadresside lisamine blokeeritakse
        unsafe_urls = [
            'http://localhost/rss',
            'http://127.0.0.1:8080/feed',
            'http://169.254.169.254/latest/meta-data/',
            'http://10.0.0.1/rss',
            'javascript:alert(1)'
        ]
        for url in unsafe_urls:
            res = self.client.post('/api/sources', json={'name': 'Evil', 'url': url})
            self.assertEqual(res.status_code, 400)


class TestArticlesWorkflow(BaseLugejaTestCase):
    """Artiklite lugemise, märkimise, avamise ja kärpimise testid."""

    def setUp(self):
        super().setUp()
        self.register_user(username="article_user")
        
        # Lisame allika ja artiklid otse andmebaasi testimiseks
        conn = lugeja.get_db_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO sources (user_id, name, url) VALUES (1, 'Test Feed', 'https://example.com/rss') RETURNING id")
        self.source_id = cur.fetchone()[0]
        
        for i in range(1, 6):
            cur.execute("""
                INSERT INTO articles (source_id, title, url, published_at, is_read, is_read_later, is_opened)
                VALUES (?, ?, ?, '2026-10-14 12:00:00', 0, 0, 0)
            """, (self.source_id, f"Uudis {i}", f"https://example.com/art-{i}"))
        conn.commit()
        conn.close()

    def test_01_get_articles_unread_only(self):
        res = self.client.get('/api/articles')
        data = res.get_json()
        self.assertEqual(len(data['articles']), 5)

    def test_02_mark_article_read_and_unread(self):
        # Märgi loetuks
        res = self.client.post('/api/articles/1/read', json={'is_read': True})
        self.assertEqual(res.status_code, 200)

        # Kontrolli, et tavavaates on nüüd 4 lugemata uudist
        data = self.client.get('/api/articles').get_json()
        self.assertEqual(len(data['articles']), 4)

        # Märgi uuesti lugemata olekusse
        self.client.post('/api/articles/1/read', json={'is_read': False})
        data2 = self.client.get('/api/articles').get_json()
        self.assertEqual(len(data2['articles']), 5)

    def test_03_mark_article_opened(self):
        res = self.client.post('/api/articles/2/open', json={'device': 'desktop'})
        self.assertEqual(res.status_code, 200)
        
        # Kontrollime andmebaasis is_opened ja is_read
        conn = lugeja.get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT is_opened, is_read FROM articles WHERE id = 2")
        row = cur.fetchone()
        self.assertEqual(row['is_opened'], 1)
        self.assertEqual(row['is_read'], 1)
        conn.close()

    def test_04_toggle_read_later(self):
        res = self.client.post('/api/articles/3/read-later')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.get_json()['is_read_later'])

        # Loe hiljem filtri testimine
        rl_data = self.client.get('/api/articles?read_later=1').get_json()
        self.assertEqual(len(rl_data['articles']), 1)
        self.assertEqual(rl_data['articles'][0]['id'], 3)

    def test_05_read_batch(self):
        res = self.client.post('/api/articles/read-batch', json={'article_ids': [4, 5]})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json()['affected'], 2)

        # Kontrolli lugemata artiklite arvu
        data = self.client.get('/api/articles').get_json()
        self.assertEqual(len(data['articles']), 3)

    def test_06_pruning_protects_read_later(self):
        """Veendu, et kärpimise loogika ei kustuta kunagi 'Loe hiljem' märgitud uudiseid."""
        conn = lugeja.get_db_connection()
        cur = conn.cursor()
        
        # Lisame spetsiaalselt vana artikli, mis on loetud ja Loe hiljem märgitud
        cur.execute("""
            INSERT INTO articles (source_id, title, url, published_at, is_read, is_read_later)
            VALUES (?, 'Tähtis salvestatud lugu', 'https://example.com/saved-forever', '2020-01-01 00:00:00', 1, 1)
        """, (self.source_id,))
        conn.commit()

        # Käivitame kärpimise 0 limiidiga (kärbi kõik loetud lood)
        lugeja.prune_unread_articles(cur, self.source_id, max_unread=0, max_read=0)
        conn.commit()

        # Kontrollime, et salvestatud lugu jäi alles
        cur.execute("SELECT COUNT(*) FROM articles WHERE url = 'https://example.com/saved-forever'")
        self.assertEqual(cur.fetchone()[0], 1)
        conn.close()


class TestOpmlExportImport(BaseLugejaTestCase):
    """OPML 2.0 ekspordi ja impordi testid."""

    def setUp(self):
        super().setUp()
        self.register_user(username="opml_user")

    def test_01_opml_export(self):
        cat_res = self.client.post('/api/categories', json={'name': 'Uudised'})
        cat_id = cat_res.get_json()['category']['id']
        with patch('parser.discover_source', return_value={'name': 'Postimees', 'url': 'https://postimees.ee/rss', 'is_rss': True, 'logo_url': None}), \
             patch('lugeja.refresh_all_sources', return_value=0):
            self.client.post('/api/sources', json={'name': 'Postimees', 'url': 'https://postimees.ee/rss', 'category_id': cat_id})

        res = self.client.get('/api/export/opml')
        self.assertEqual(res.status_code, 200)
        self.assertIn(b'<opml version="2.0">', res.data)
        self.assertIn(b'xmlUrl="https://postimees.ee/rss"', res.data)
        self.assertIn(b'text="Uudised"', res.data)

    def test_02_opml_import_success(self):
        sample_opml = b"""<?xml version="1.0" encoding="utf-8"?>
        <opml version="2.0">
          <head><title>Test OPML</title></head>
          <body>
            <outline text="Tehnoloogia">
              <outline text="Hacker News" type="rss" xmlUrl="https://news.ycombinator.com/rss"/>
            </outline>
            <outline text="Ars Technica" type="rss" xmlUrl="https://feeds.arstechnica.com/arstechnica/index"/>
          </body>
        </opml>"""

        with patch('lugeja.refresh_all_sources', return_value=0):
            res = self.client.post('/api/import/opml', data={
                'file': (BytesIO(sample_opml), 'test.opml')
            }, content_type='multipart/form-data')

        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data['imported_count'], 2)
        self.assertEqual(data['categories_created'], 1)

    def test_03_opml_import_xxe_protection(self):
        malicious_opml = b"""<?xml version="1.0"?>
        <!DOCTYPE foo [
          <!ELEMENT foo ANY >
          <!ENTITY xxe SYSTEM "file:///etc/passwd" >]>
        <opml version="2.0">
          <body><outline text="&xxe;" type="rss" xmlUrl="https://evil.com/rss"/></body>
        </opml>"""

        res = self.client.post('/api/import/opml', data={
            'file': (BytesIO(malicious_opml), 'evil.opml')
        }, content_type='multipart/form-data')

        self.assertEqual(res.status_code, 400)
        self.assertIn('keelatud väliseid olemideklaratsioone', res.get_json()['error'])


class TestParserLogic(unittest.TestCase):
    """parser.py funktsioonide, veakindluse ja saniteerimise testid."""

    def test_01_is_safe_url(self):
        self.assertTrue(parser.is_safe_url('https://err.ee'))
        self.assertTrue(parser.is_safe_url('https://postimees.ee/rss'))
        
        self.assertFalse(parser.is_safe_url('http://127.0.0.1'))
        self.assertFalse(parser.is_safe_url('http://localhost'))
        self.assertFalse(parser.is_safe_url('http://169.254.169.254/meta-data'))
        self.assertFalse(parser.is_safe_url('ftp://example.com'))
        self.assertFalse(parser.is_safe_url('javascript:void(0)'))

    def test_02_sanitize_article_url(self):
        self.assertEqual(parser.sanitize_article_url('/uudis/1', 'https://err.ee'), 'https://err.ee/uudis/1')
        self.assertEqual(parser.sanitize_article_url('javascript:alert(1)'), '')
        self.assertEqual(parser.sanitize_article_url('data:text/html,evil'), '')
        # Protokollivaba // URL
        self.assertEqual(parser.sanitize_article_url('//err.ee/uudis/1'), 'https://err.ee/uudis/1')

    def test_03_sanitize_image_url(self):
        # Ohutu HTTP/HTTPS URL
        self.assertEqual(parser.sanitize_image_url('https://img.ee/pilt.jpg'), 'https://img.ee/pilt.jpg')
        # Protokollivaba // URL teisendatakse https-iks
        self.assertEqual(parser.sanitize_image_url('//img.ee/pilt.jpg'), 'https://img.ee/pilt.jpg')
        # Ohutu base64 rasterpilt
        valid_b64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
        self.assertEqual(parser.sanitize_image_url(valid_b64), valid_b64)
        # Ohtlik SVG data-skeem (tõkestatud)
        self.assertEqual(parser.sanitize_image_url('data:image/svg+xml;base64,PHN2Zz4='), '')

    def test_04_extract_image_from_entry(self):
        # media_content
        entry1 = MagicMock()
        entry1.media_content = [{'url': 'https://example.com/media.jpg', 'type': 'image/jpeg'}]
        self.assertEqual(parser.extract_image_from_entry(entry1), 'https://example.com/media.jpg')

        # enclosure
        entry2 = MagicMock(spec=[])
        entry2.enclosures = [{'href': 'https://example.com/enc.png', 'type': 'image/png'}]
        self.assertEqual(parser.extract_image_from_entry(entry2), 'https://example.com/enc.png')

        # og:image meta-silt kirjeldusest
        entry_og = MagicMock(spec=[])
        entry_og.description = '<html><head><meta property="og:image" content="https://example.com/og-lead.jpg"></head><body>Sisu</body></html>'
        self.assertEqual(parser.extract_image_from_entry(entry_og), 'https://example.com/og-lead.jpg')

        # <img> kirjeldusest, kus ignoreeritakse 1x1 pikslit
        entry3 = MagicMock(spec=[])
        entry3.description = '<p><img src="https://tracker.com/1x1.gif"><img src="https://example.com/real.jpg"></p>'
        self.assertEqual(parser.extract_image_from_entry(entry3), 'https://example.com/real.jpg')

    def test_05_clean_text(self):
        self.assertEqual(parser.clean_text("  Pealkiri   mitme    tühikuga \n "), "Pealkiri mitme tühikuga")
        self.assertEqual(parser.clean_text({'value': 'Objektist pealkiri'}), "Objektist pealkiri")
        self.assertEqual(parser.clean_text(None), "")


class TestStaticFilesIntegrity(unittest.TestCase):
    """Kasutajaliidese ja staatiliste failide lepingute vastavuse testid."""

    def test_01_index_html_modal_accessibility(self):
        html_path = os.path.join(BASE_DIR, 'templates', 'index.html')
        with open(html_path, 'r', encoding='utf-8') as f:
            content = f.read()

        modals = [
            'addSourceModal', 'editSourceModal', 'deleteSourceModal',
            'addCategoryModal', 'editCategoryModal', 'deleteCategoryModal',
            'userProfileModal', 'deleteAccountModal'
        ]
        for m_id in modals:
            pattern = rf'id="{m_id}"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="{m_id}Title"'
            self.assertTrue(bool(re.search(pattern, content)), f"Modaalaknal {m_id} puuduvad korrektsed ARIA ligipääsetavuse atribuudid!")

        stats_ids = [
            'statSourcesCount', 'statCategoriesCount', 'statScrolledReadCount',
            'statOpenedCount', 'statOpenedRate', 'statMostActiveSourceName',
            'statFavoriteSourceName', 'deviceMobilePercent', 'deviceDesktopPercent'
        ]
        for s_id in stats_ids:
            self.assertIn(f'id="{s_id}"', content, f"HTML-ist puudub statistika element id={s_id}")

    def test_02_sw_js_integrity(self):
        sw_path = os.path.join(BASE_DIR, 'static', 'sw.js')
        with open(sw_path, 'r', encoding='utf-8') as f:
            content = f.read()

        self.assertIn('function getCleanApiRequest(request)', content)
        self.assertIn("url.searchParams.delete('_t')", content)
        self.assertIn("url.pathname.startsWith('/api/auth/')", content)

    def test_03_app_js_integrity(self):
        app_path = os.path.join(BASE_DIR, 'static', 'js', 'app.js')
        with open(app_path, 'r', encoding='utf-8') as f:
            content = f.read()

        self.assertIn('statSourcesCount', content)
        self.assertIn('statCategoriesCount', content)
        self.assertIn('loading="lazy"', content)
        self.assertIn('decoding="async"', content)
        self.assertIn('referrerpolicy="no-referrer"', content)


if __name__ == '__main__':
    unittest.main(verbosity=2)
