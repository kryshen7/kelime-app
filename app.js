// app.js
require("dotenv").config();

const express = require("express");
const path = require("path");
const pool = require("./db");

const session = require("express-session");
const bcrypt = require("bcryptjs");
const MySQLStore = require("express-mysql-session")(session);

const app = express();

// View engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Body + static
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// session store (MySQL)
const sessionStore = new MySQLStore(
  {
    clearExpired: true,
    checkExpirationInterval: 1000 * 60 * 15, // 15 dk
    expiration: 1000 * 60 * 60 * 24 * 7, // 7 gün
  },
  pool
);

app.use(
  session({
    key: "kelimeapp_sid",
    secret: process.env.SESSION_SECRET || "kelimeapp_super_secret_123",
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true },
  })
);

// views içinde kullanıcıyı görebilelim
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function detectLang(word) {
  const trChars = /[çğıöşüİ]/i;
  return trChars.test(word) ? "tr" : "en";
}

// Home (korumalı)
app.get("/", requireAuth, (req, res) => {
  res.render("index", { result: null, error: null, query: "" });
});

// Register
app.get("/register", (req, res) => {
  if (req.session.user) return res.redirect("/");
  res.render("register", { error: null, form: { username: "", email: "" } });
});

app.post("/register", async (req, res) => {
  const username = (req.body.username || "").trim();
  const email = (req.body.email || "").trim().toLowerCase();
  const password = (req.body.password || "").trim();

  if (!username || !email || !password) {
    return res.render("register", {
      error: "Lütfen tüm alanları doldur.",
      form: { username, email },
    });
  }

  try {
    const [exists] = await pool.query(
      "SELECT id FROM users WHERE email=? LIMIT 1",
      [email]
    );

    if (exists.length) {
      return res.render("register", {
        error: "Bu email zaten kayıtlı.",
        form: { username, email },
      });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const [ins] = await pool.query(
      "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
      [username, email, password_hash]
    );

    req.session.user = { id: ins.insertId, username, email };
    return res.redirect("/");
  } catch (err) {
    console.error(err);
    return res.render("register", {
      error: "Kayıt sırasında hata oluştu.",
      form: { username, email },
    });
  }
});

// Login
app.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/");
  res.render("login", { error: null, form: { email: "" } });
});

app.post("/login", async (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  const password = (req.body.password || "").trim();

  if (!email || !password) {
    return res.render("login", {
      error: "Email ve şifre gir.",
      form: { email },
    });
  }

  try {
    const [rows] = await pool.query(
      "SELECT * FROM users WHERE email=? LIMIT 1",
      [email]
    );

    if (!rows.length) {
      return res.render("login", {
        error: "Email veya şifre yanlış.",
        form: { email },
      });
    }

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);

    if (!ok) {
      return res.render("login", {
        error: "Email veya şifre yanlış.",
        form: { email },
      });
    }

    req.session.user = { id: user.id, username: user.username, email: user.email };
    return res.redirect("/");
  } catch (err) {
    console.error(err);
    return res.render("login", {
      error: "Giriş sırasında hata oluştu.",
      form: { email },
    });
  }
});

// Logout
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// Admin - Kelime Listesi
app.get("/admin/words", requireAuth, async (req, res) => {
  const [words] = await pool.query("SELECT * FROM words ORDER BY id DESC");
  res.render("admin_words", { words, error: null });
});

// Admin - Kelime Ekle (CREATE)
app.post("/admin/words", requireAuth, async (req, res) => {
  const tr = (req.body.tr || "").trim().toLowerCase();
  const en = (req.body.en || "").trim().toLowerCase();

  if (!tr || !en) {
    const [words] = await pool.query("SELECT * FROM words ORDER BY id DESC");
    return res.render("admin_words", { words, error: "TR ve EN alanlarını doldur." });
  }

  try {
    await pool.query("INSERT INTO words (tr, en) VALUES (?, ?)", [tr, en]);
    return res.redirect("/admin/words");
  } catch (e) {
    const [words] = await pool.query("SELECT * FROM words ORDER BY id DESC");
    return res.render("admin_words", { words, error: "Bu kelime zaten var olabilir (unique)." });
  }
});

// Admin - Kelime Düzenleme Sayfası
app.get("/admin/words/:id/edit", requireAuth, async (req, res) => {
  const id = req.params.id;
  const [rows] = await pool.query("SELECT * FROM words WHERE id=?", [id]);
  if (!rows.length) return res.redirect("/admin/words");
  res.render("admin_edit_word", { word: rows[0], error: null });
});

// Admin - Kelime Güncelle (UPDATE)
app.post("/admin/words/:id/edit", requireAuth, async (req, res) => {
  const id = req.params.id;
  const tr = (req.body.tr || "").trim().toLowerCase();
  const en = (req.body.en || "").trim().toLowerCase();

  if (!tr || !en) {
    const [rows] = await pool.query("SELECT * FROM words WHERE id=?", [id]);
    return res.render("admin_edit_word", { word: rows[0], error: "TR ve EN boş olamaz." });
  }

  try {
    await pool.query("UPDATE words SET tr=?, en=? WHERE id=?", [tr, en, id]);
    return res.redirect("/admin/words");
  } catch (e) {
    const [rows] = await pool.query("SELECT * FROM words WHERE id=?", [id]);
    return res.render("admin_edit_word", { word: rows[0], error: "Güncelleme hatası (unique çakışmış olabilir)." });
  }
});

// Admin - Kelime Sil (DELETE)
app.post("/admin/words/:id/delete", requireAuth, async (req, res) => {
  const id = req.params.id;
  await pool.query("DELETE FROM words WHERE id=?", [id]);
  res.redirect("/admin/words");
});

// Search
app.post("/search", requireAuth, async (req, res) => {
  const queryRaw = (req.body.word || "").trim();
  const query = queryRaw.toLowerCase();

  if (!query) {
    return res.render("index", { result: null, error: "Lütfen bir kelime gir.", query: "" });
  }

  try {
    const [rows] = await pool.query(
      "SELECT * FROM words WHERE LOWER(tr)=? OR LOWER(en)=? LIMIT 1",
      [query, query]
    );

    if (rows.length === 0) {
      const [suggestions] = await pool.query(
        "SELECT tr, en FROM words WHERE tr LIKE ? OR en LIKE ? LIMIT 6",
        [`%${query}%`, `%${query}%`]
      );

      const sugText = suggestions.length
        ? "Bunu mu demek istedin: " + suggestions.map(s => `${s.tr} / ${s.en}`).join(", ")
        : "Bu kelime veritabanında yok.";

      return res.render("index", { result: null, error: sugText, query: queryRaw });
    }

    const word = rows[0];

    let inputLang = "en";
    if (word.tr.toLowerCase() === query) inputLang = "tr";
    else if (word.en.toLowerCase() === query) inputLang = "en";
    else inputLang = detectLang(queryRaw);

    const translation = inputLang === "tr" ? word.en : word.tr;

    let [exRows] = await pool.query(
      "SELECT sentence FROM examples WHERE word_id=? AND lang=? ORDER BY RAND() LIMIT 1",
      [word.id, inputLang]
    );

    if (exRows.length === 0) {
      [exRows] = await pool.query(
        "SELECT sentence FROM examples WHERE word_id=? ORDER BY RAND() LIMIT 1",
        [word.id]
      );
    }

    const example = exRows.length ? exRows[0].sentence : "Örnek cümle bulunamadı.";

    return res.render("index", {
      result: { input: queryRaw, inputLang, tr: word.tr, en: word.en, translation, example },
      error: null,
      query: queryRaw,
    });
  } catch (err) {
    console.error(err);
    return res.render("index", { result: null, error: "Sunucu hatası oluştu.", query: queryRaw });
  }
});

module.exports = app;
