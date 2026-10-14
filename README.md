<h1 align="center">
  <img src="static/icons/icon-192.png" alt="Lugeja Logo" width="96" height="96"><br>
  Lugeja
</h1>

Veebirakendus RSS-voogude ja veebiuudiste lugemiseks.

---

## Põhiomadused

* **Universaalne uudiste tugi:** Toetab standardseid RSS/Atom vooge (ERR, BBC jne) ning kraabib automaatselt uudiseid ka lehtedelt, millel puudub ametlik RSS (Delfi, Äripäev).
* **Kvaliteetsed pisipildid:** Automaatsed kaanepildid ja sujuv asenduskujundus pildi puudumisel.
* **Mobiilisõbralik:** Spetsiaalselt optimeeritud paigutus telefonidele, mugav kerimine ja lugemisjärje säilitamine äppide vahetamisel.
* **Progressive Web App (PWA):** Paigaldatav iseseisva rakendusena töölauale ja telefoni avaekraanile. Toetab võrguühenduseta (*Offline*) režiimi varem laaditud uudistele.
* **Mitme kasutaja tugi ja statistika:** Turvaline autentimine, esimene kasutaja on administraator, profiilipaneel koos lugemisstatistika ja seadmekasutuse graafikuga.
* **Tellimuste OPML eksport ja import:** Täielik OPML 2.0 tugi voogude varundamiseks või teistest lugejatest üleviimiseks.
* **Kategooriad ja "Loe hiljem":** Allikate rühmitamine teemade kaupa ning oluliste lugude talletamine püsivasse järjehoidjasse.
* **Hübriidne andmebaas:** Töötab lokaalselt kergekaalulise SQLite failiga või pilves distributed libSQL baasiga (**Turso**).

---

## Paigaldamine lokaalselt

1. **Klooni repositoorium ja loo virtuaalkeskkond:**
   ```bash
   git clone https://github.com/kr15tj4n/Lugeja.git
   cd Lugeja
   python3 -m venv .venv
   source .venv/bin/activate
   ```

2. **Paigalda sõltuvused:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Käivita rakendus:**
   ```bash
   python3 lugeja.py
   ```

4. **Ava brauseris:**
   Mine aadressile `http://127.0.0.1:5000`. Esimene registreeritud konto saab automaatselt administraatori staatuse.

---

## Paigaldamine Renderis ja Tursos

### 1. Turso andmebaasi seadistamine (turso.tech)

1. Loo tasuta konto aadressil [turso.tech](https://turso.tech) ja paigalda Turso CLI (või kasuta Turso veebiliidest).
2. Loo uus andmebaas:
   ```bash
   turso db create lugeja
   ```
3. Hangi andmebaasi URL:
   ```bash
   turso db show lugeja --url
   # Väljund on kujul: libsql://lugeja-[sinu-tiim].turso.io
   ```
4. Loo andmebaasile püsiv autentimistoken:
   ```bash
   turso db tokens create lugeja
   ```

### 2. Render.com veebiteenuse seadistamine (render.com)

1. Loo tasuta konto aadressil [render.com](https://render.com) ja ühenda oma Git repositoorium.
2. Vali **New +** -> **Web Service**.
3. Määra teenuse parameetrid:
   * **Name:** `lugeja` (või vabalt valitud nimi)
   * **Region:** Vali geograafiliselt lähim (nt Frankfurt / Europe)
   * **Runtime:** `Python 3`
   * **Build Command:**
     ```bash
     pip install -r requirements.txt
     ```
   * **Start Command:**
     ```bash
     gunicorn lugeja:app
     ```
4. Lisa keskkonnamuutujad (**Environment Variables**):
   * **Andmebaas ja seansiturvalisus:**
     * `TURSO_DATABASE_URL` — Turso andmebaasi URL (nt `libsql://lugeja-[sinu-tiim].turso.io`)
     * `TURSO_AUTH_TOKEN` — Turso autentimistoken (sammus 1 loodud võti)
     * `SECRET_KEY` — Pikk juhuslik turvavõti seansside krüpteerimiseks
     * `APP_URL` — (Valikuline) Rakenduse avalik baas-URL (nt `https://lugeja.onrender.com`)
   * **Parooli taastamine e-postiga (Gmaili SMTP näide):**
     * `SMTP_HOST` — `smtp.gmail.com`
     * `SMTP_PORT` — `587`
     * `SMTP_USER` — `sinu.email@gmail.com`
     * `SMTP_PASSWORD` — Google'i 16-kohaline rakenduse parool (*App Password*, genereeri: [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords))
     * `SMTP_FROM` — `sinu.email@gmail.com`
     * `SMTP_TLS` — `true`

5. Vajuta **Deploy Web Service**.

Rakendus käivitub automaatselt, initsialiseerib esimesel pöördumisel Turso andmebaasis vajalikud tabelid ja on valmis kasutamiseks.
