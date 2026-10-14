/**
 * Lugeja - Frontend JavaScript
 * IntersectionObserver, Fetch API, live-filtreerimine, auto-refresh
 */

// Brauseri automaatse kerimisasendi meeldejätmise keelamine dünaamilise uudisvoo puhul
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}

document.addEventListener('DOMContentLoaded', () => {
  // Olek (State)
  let currentUser = null; // Sisselogitud kasutaja objekt { id, username, is_admin, created_at }
  let currentSourceId = null; // null tähendab "Kõik"
  let currentCategoryId = null; // null tähendab, et kategooria järgi ei filtreerita
  let isReadLaterView = false;
  let readLaterCount = 0;
  let showReadArticles = false;
  let articlesData = [];
  let sourcesData = [];
  let categoriesData = [];
  let collapsedCategories = new Set();
  let sourcesLoaded = false;
  let articlesLoaded = false;
  let isUpdating = false;
  let isMarkingAllRead = false;
  let feedReachedEnd = false; // Tähistab, et uudisvoo kerimine on jõudnud lõppu

  // IntersectionObserver loetuks märkimiseks
  let articleObserver = null;
  const readQueue = new Set();
  let readQueueTimeout = null;

  // DOM elemendid
  const sourcesListEl = document.getElementById('sourcesList');
  const feedContainerEl = document.getElementById('feedContainer');
  const currentViewTitleEl = document.getElementById('currentViewTitle');
  const currentViewCountEl = document.getElementById('currentViewCount');
  const totalUnreadBadgeEl = document.getElementById('totalUnreadBadge');
  const navItemReadLater = document.getElementById('navItemReadLater');
  const readLaterBadgeEl = document.getElementById('readLaterBadge');
  const btnRefresh = document.getElementById('btnRefresh');
  const refreshIcon = document.getElementById('refreshIcon');
  const btnMarkAllRead = document.getElementById('btnMarkAllRead');
  const btnToggleRead = document.getElementById('btnToggleRead');
  const statusIndicatorEl = document.getElementById('statusIndicator');
  const btnScrollTop = document.getElementById('btnScrollTop');

  // Rippmenüü ("Lisa")
  const addDropdownWrap = document.getElementById('addDropdownWrap');
  const btnOpenAddDropdown = document.getElementById('btnOpenAddDropdown');
  const addDropdownMenu = document.getElementById('addDropdownMenu');
  const btnAddSourceChoice = document.getElementById('btnAddSourceChoice');
  const btnAddCategoryChoice = document.getElementById('btnAddCategoryChoice');

  // Kategooria valikud allika modaalides
  const sourceCategorySelect = document.getElementById('sourceCategory');
  const editSourceCategorySelect = document.getElementById('editSourceCategory');

  // Allika lisamise modaal
  const addSourceModal = document.getElementById('addSourceModal');
  const btnCloseAddSource = document.getElementById('btnCloseAddSource');
  const btnCancelAddSource = document.getElementById('btnCancelAddSource');
  const addSourceForm = document.getElementById('addSourceForm');
  const btnSubmitSource = document.getElementById('btnSubmitSource');

  // Allika kustutamise kinnitusmodaal
  const deleteSourceModal = document.getElementById('deleteSourceModal');
  const deleteSourceNameEl = document.getElementById('deleteSourceName');
  const btnCloseDeleteModal = document.getElementById('btnCloseDeleteModal');
  const btnCancelDeleteSource = document.getElementById('btnCancelDeleteSource');
  const btnConfirmDeleteSource = document.getElementById('btnConfirmDeleteSource');
  let pendingDeleteSource = null;

  // Allika muutmise modaal
  const editSourceModal = document.getElementById('editSourceModal');
  const editSourceForm = document.getElementById('editSourceForm');
  const editSourceIdInput = document.getElementById('editSourceId');
  const editSourceNameInput = document.getElementById('editSourceName');
  const editSourceUrlInput = document.getElementById('editSourceUrl');
  const btnCloseEditSource = document.getElementById('btnCloseEditSource');
  const btnCancelEditSource = document.getElementById('btnCancelEditSource');
  const btnSubmitEditSource = document.getElementById('btnSubmitEditSource');

  // Kategooria lisamise modaal
  const addCategoryModal = document.getElementById('addCategoryModal');
  const btnCloseAddCategory = document.getElementById('btnCloseAddCategory');
  const btnCancelAddCategory = document.getElementById('btnCancelAddCategory');
  const addCategoryForm = document.getElementById('addCategoryForm');
  const categoryNameInput = document.getElementById('categoryName');
  const btnSubmitCategory = document.getElementById('btnSubmitCategory');

  // Kategooria muutmise modaal
  const editCategoryModal = document.getElementById('editCategoryModal');
  const btnCloseEditCategory = document.getElementById('btnCloseEditCategory');
  const btnCancelEditCategory = document.getElementById('btnCancelEditCategory');
  const editCategoryForm = document.getElementById('editCategoryForm');
  const editCategoryIdInput = document.getElementById('editCategoryId');
  const editCategoryNameInput = document.getElementById('editCategoryName');
  const btnSubmitEditCategory = document.getElementById('btnSubmitEditCategory');

  // Kategooria kustutamise kinnitusmodaal
  const deleteCategoryModal = document.getElementById('deleteCategoryModal');
  const deleteCategoryTargetName = document.getElementById('deleteCategoryTargetName');
  const btnCloseDeleteCategoryModal = document.getElementById('btnCloseDeleteCategoryModal');
  const btnCancelDeleteCategory = document.getElementById('btnCancelDeleteCategory');
  const btnConfirmDeleteCategory = document.getElementById('btnConfirmDeleteCategory');
  let pendingDeleteCategory = null;

  // Külgriba ja mobiilne menüü
  const btnToggleSidebar = document.getElementById('btnToggleSidebar');
  const sidebarOverlay = document.getElementById('sidebarOverlay');
  const sidebar = document.getElementById('sidebar');

  // Kasutajahaldus ja profiili modaal
  const btnUserMenu = document.getElementById('btnUserMenu');
  const userAvatarInitial = document.getElementById('userAvatarInitial');
  const userProfileModal = document.getElementById('userProfileModal');
  const btnCloseUserProfileModal = document.getElementById('btnCloseUserProfileModal');
  const userProfileAvatarInitial = document.getElementById('userProfileAvatarInitial');
  const userProfileUsername = document.getElementById('userProfileUsername');
  const userProfileRoleBadge = document.getElementById('userProfileRoleBadge');
  const userProfileCreated = document.getElementById('userProfileCreated');
  const userProfileEmailRow = document.getElementById('userProfileEmailRow');
  const userProfileEmailVal = document.getElementById('userProfileEmailVal');
  const btnOpenEditEmail = document.getElementById('btnOpenEditEmail');
  const profileEmailEditForm = document.getElementById('profileEmailEditForm');
  const profileEmailInput = document.getElementById('profileEmailInput');
  const btnCancelProfileEmail = document.getElementById('btnCancelProfileEmail');
  const btnProfileExportOpml = document.getElementById('btnProfileExportOpml');
  const btnProfileImportOpml = document.getElementById('btnProfileImportOpml');
  const btnProfileImportOpmlText = document.getElementById('btnProfileImportOpmlText');
  const btnAddSourceImportOpml = document.getElementById('btnAddSourceImportOpml');
  const opmlFileInput = document.getElementById('opmlFileInput');
  const btnLogout = document.getElementById('btnLogout');
  const adminProtectedNotice = document.getElementById('adminProtectedNotice');
  const btnOpenDeleteAccountModal = document.getElementById('btnOpenDeleteAccountModal');

  // Kasutaja statistika elemendid
  const statAccountAge = document.getElementById('statAccountAge');
  const statOpenedCount = document.getElementById('statOpenedCount');
  const statOpenedRate = document.getElementById('statOpenedRate');
  const statScrolledReadCount = document.getElementById('statScrolledReadCount');
  const statSourcesCount = document.getElementById('statSourcesCount');
  const statCategoriesCount = document.getElementById('statCategoriesCount');
  const statMostActiveSourceRow = document.getElementById('statMostActiveSourceRow');
  const statMostActiveSourceName = document.getElementById('statMostActiveSourceName');
  const statFavoriteSourceRow = document.getElementById('statFavoriteSourceRow');
  const statFavoriteSourceName = document.getElementById('statFavoriteSourceName');
  const userDeviceUsageCard = document.getElementById('userDeviceUsageCard');
  const deviceBarTrack = document.getElementById('deviceBarTrack');
  const deviceMobilePercent = document.getElementById('deviceMobilePercent');
  const deviceDesktopPercent = document.getElementById('deviceDesktopPercent');
  const deviceBarSegmentMobile = document.getElementById('deviceBarSegmentMobile');
  const deviceBarSegmentDesktop = document.getElementById('deviceBarSegmentDesktop');

  const USER_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';
  const USER_LARGE_ICON_SVG = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';

  // Taastame salvestatud kasutaja initsiaali koheselt (väldib igasugust virvendust või küsimärki lehe laadimisel)
  const savedInitial = localStorage.getItem('lugeja_user_initial');
  if (savedInitial) {
    if (userAvatarInitial) userAvatarInitial.textContent = savedInitial;
    if (userProfileAvatarInitial) userProfileAvatarInitial.textContent = savedInitial;
  }

  // Seadmetüübi tuvastamine ja statistika
  function isMobileDevice() {
    const ua = navigator.userAgent || '';
    const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    const isSmallScreen = window.innerWidth <= 900;
    return isMobileUA || (hasTouch && isSmallScreen);
  }

  async function pingDeviceUsage() {
    if (!currentUser) return;
    const sessionKey = 'lugeja_device_pinged_' + (currentUser.id || currentUser.username);
    if (sessionStorage.getItem(sessionKey)) return;
    try {
      const device = isMobileDevice() ? 'mobile' : 'desktop';
      await fetch('/api/user/device', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Type': device
        },
        body: JSON.stringify({ device })
      });
      sessionStorage.setItem(sessionKey, '1');
    } catch (e) {
      // Ignore
    }
  }

  // Kasutaja kustutamise kinnitusmodaal
  const deleteAccountModal = document.getElementById('deleteAccountModal');
  const deleteAccountUsername = document.getElementById('deleteAccountUsername');
  const btnCloseDeleteAccountModal = document.getElementById('btnCloseDeleteAccountModal');
  const btnCancelDeleteAccount = document.getElementById('btnCancelDeleteAccount');
  const btnConfirmDeleteAccount = document.getElementById('btnConfirmDeleteAccount');

  // Autentimise kiht ja vormid
  const authOverlay = document.getElementById('authOverlay');
  const authTabs = document.getElementById('authTabs');
  const tabLogin = document.getElementById('tabLogin');
  const tabRegister = document.getElementById('tabRegister');
  const authErrorBanner = document.getElementById('authErrorBanner');
  const authSuccessBanner = document.getElementById('authSuccessBanner');
  const loginForm = document.getElementById('loginForm');
  const loginUsernameInput = document.getElementById('loginUsername');
  const loginPasswordInput = document.getElementById('loginPassword');
  const btnForgotPassword = document.getElementById('btnForgotPassword');

  const registerForm = document.getElementById('registerForm');
  const regUsernameInput = document.getElementById('regUsername');
  const regEmailInput = document.getElementById('regEmail');
  const regPasswordInput = document.getElementById('regPassword');
  const regPasswordConfirmInput = document.getElementById('regPasswordConfirm');
  const authAdminHint = document.getElementById('authAdminHint');

  const forgotPasswordForm = document.getElementById('forgotPasswordForm');
  const forgotIdentifierInput = document.getElementById('forgotIdentifier');
  const btnSubmitForgot = document.getElementById('btnSubmitForgot');
  const btnBackToLoginFromForgot = document.getElementById('btnBackToLoginFromForgot');

  const resetPasswordForm = document.getElementById('resetPasswordForm');
  const resetNewPasswordInput = document.getElementById('resetNewPassword');
  const resetNewPasswordConfirmInput = document.getElementById('resetNewPasswordConfirm');
  const btnSubmitReset = document.getElementById('btnSubmitReset');
  const btnBackToLoginFromReset = document.getElementById('btnBackToLoginFromReset');

  let activeResetToken = window.INITIAL_RESET_TOKEN || new URLSearchParams(window.location.search).get('token') || '';

  // Toast
  const toastContainer = document.getElementById('toastContainer');

  // ==========================================================================
  // Teavitused (Toasts)
  // ==========================================================================
  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        ${type === 'success' 
          ? '<path d="M20 6L9 17l-5-5"/>' 
          : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'}
      </svg>
      <span>${escapeHtml(message)}</span>
    `;
    toastContainer.appendChild(toast);

    // Animatsioon
    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return '#';
    const clean = url.trim();
    if (/^https?:\/\//i.test(clean)) {
      return clean;
    }
    return '#';
  }

  function sanitizeImageUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const clean = url.trim();
    if (/^https?:\/\//i.test(clean) || /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,/i.test(clean)) {
      return clean;
    }
    return '';
  }

  // ==========================================================================
  // Kuupäeva ja kellaaja vormindamine (lihtsalt kuupäev ja kellaaeg)
  // ==========================================================================
  function formatDateTime(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString.replace(' ', 'T'));
    if (isNaN(date.getTime())) return dateString;

    const pad = (n) => String(n).padStart(2, '0');
    const day = pad(date.getDate());
    const month = pad(date.getMonth() + 1);
    const year = date.getFullYear();
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());

    return `${day}.${month}.${year} ${hours}:${minutes}`;
  }

  // ==========================================================================
  // IntersectionObserver ja kerimise seadistus:
  // Artikkel märgitakse automaatselt loetuks AINULT siis, kui kasutaja on sellest
  // mööda kerinud ja see on liikunud ekraani ülaservast (päise tagant) ülesse välja.
  // ==========================================================================
  let scrollCheckTimeout = null;
  let activeViewKey = ''; // Aktiivse vaate unikaalne võti vaatevahetuse tuvastamiseks
  let scrollTopArrivalRaf = null;
  let scrollTopTimeout = null;

  function resetFeedScrollPosition() {
    flushReadQueue();
    if (articleObserver) {
      articleObserver.disconnect();
    }
    if (scrollTopArrivalRaf) {
      cancelAnimationFrame(scrollTopArrivalRaf);
      scrollTopArrivalRaf = null;
    }
    if (scrollTopTimeout) {
      clearTimeout(scrollTopTimeout);
      scrollTopTimeout = null;
    }
    clearTimeout(scrollCheckTimeout);
    feedReachedEnd = false;
    lastActiveScrollY = 0;
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (btnScrollTop) {
      btnScrollTop.classList.remove('visible');
    }
  }

  function markAllRemainingFeedArticlesAsRead() {
    if (!feedContainerEl) return;
    const unreadArticles = feedContainerEl.querySelectorAll('.article-item:not(.is-read)');
    if (unreadArticles.length > 0) {
      unreadArticles.forEach((el) => {
        const articleId = parseInt(el.dataset.id, 10);
        if (articleId) {
          queueArticleAsRead(articleId, el);
        }
      });
      flushReadQueue();
    }
  }

  function triggerEmptyFeedState() {
    if (!feedReachedEnd) return;
    feedReachedEnd = false;

    if (articleObserver) {
      articleObserver.disconnect();
    }

    flushReadQueue();

    // Tühjendame mälus artiklid, sest kogu uudisvoog on loetud
    articlesData = [];

    // Renderdame standardse tühja voo vaate ("Uudiseid pole praegu kuvada")
    renderFeed();

    // Viime kerimise puhtalt lehe päisesse
    window.scrollTo({ top: 0, behavior: 'instant' });

    // Värskendame loendurid külgribal
    if (currentSourceId) {
      const src = sourcesData.find((s) => s.id === currentSourceId);
      if (src) src.unread_count = 0;
    } else if (currentCategoryId) {
      sourcesData.forEach((s) => {
        if (s.category_id === currentCategoryId) s.unread_count = 0;
      });
    } else {
      sourcesData.forEach((s) => s.unread_count = 0);
    }
    renderSources();

    if (btnScrollTop) {
      btnScrollTop.classList.remove('visible');
    }
  }

  function checkFeedScrollPosition() {
    if (document.hidden || document.body.classList.contains('modal-open')) return;
    if (showReadArticles || isReadLaterView) return;
    if (!articlesData || articlesData.length === 0 || feedContainerEl.classList.contains('has-empty-state')) return;

    const windowHeight = window.innerHeight;
    const scrollHeight = document.documentElement.scrollHeight;
    const scrollY = window.scrollY || document.documentElement.scrollTop;
    const distanceToBottom = scrollHeight - (scrollY + windowHeight);

    // 1. Kas uudisvoo kerimine on jõudnud lõppu?
    const isAtBottom = scrollHeight > windowHeight && (distanceToBottom <= 100 || (distanceToBottom <= windowHeight * 0.8 && feedContainerEl.querySelectorAll('.article-item:not(.is-read)').length === 0));

    if (isAtBottom) {
      if (!feedReachedEnd) {
        feedReachedEnd = true;
        markAllRemainingFeedArticlesAsRead();
      }
    }

    // 2. Kui varem jõuti voo lõppu ja nüüd keriti tagasi lehe algusesse
    if (feedReachedEnd && scrollY <= 30) {
      triggerEmptyFeedState();
    }
  }

  function checkScrolledPastArticles() {
    // Kui dokument on taustal või modaalaken on avatud, ei tohi artikleid loetuks märkida
    if (document.hidden || document.body.classList.contains('modal-open')) return;

    const windowHeight = window.innerHeight;
    const scrollHeight = document.documentElement.scrollHeight;
    const scrollY = window.scrollY || document.documentElement.scrollTop;
    const distanceToBottom = scrollHeight - (scrollY + windowHeight);
    const isAtBottom = scrollHeight > windowHeight && distanceToBottom <= 100;

    const unreadArticles = feedContainerEl ? feedContainerEl.querySelectorAll('.article-item:not(.is-read)') : [];
    if (unreadArticles.length === 0) return;

    // 1. Lugemise faas (Read phase): teeme geomeetrilised mõõtmised ilma DOM-i muutmata
    const toMarkRead = [];
    for (let i = 0; i < unreadArticles.length; i++) {
      const el = unreadArticles[i];
      const rect = el.getBoundingClientRect();

      // Kuna uudisvoog on vertikaalselt järjestatud, siis ekraani allservast allpool olevate artiklite
      // puhul teame, et kõik järgnevad on veelgi kaugemal all. Katkestame tsükli varakult (säästab 99% tööst)!
      if (rect.top > windowHeight + 100) {
        break;
      }

      // Märgime loetuks, kui artikkel on vaateväljast üles välja keritud või lehe allservas ülaossa jõudnud
      if (rect.height > 0 && ((rect.bottom <= 50 && rect.top < 50) || (isAtBottom && rect.top <= 100))) {
        toMarkRead.push(el);
      }
    }

    // 2. Kirjutamise faas (Write phase): muudame DOM-i alles pärast kõigi mõõtmiste lõppu
    if (toMarkRead.length > 0) {
      for (let i = 0; i < toMarkRead.length; i++) {
        const el = toMarkRead[i];
        const articleId = parseInt(el.dataset.id, 10);
        if (articleId) {
          queueArticleAsRead(articleId, el);
        }
      }
    }
  }

  function setupIntersectionObserver() {
    if (articleObserver) {
      articleObserver.disconnect();
    }

    // Jälgime elementide liikumist vaateväljast välja
    const options = {
      root: null,
      rootMargin: '0px',
      threshold: 0
    };

    articleObserver = new IntersectionObserver((entries) => {
      // Kui leht on taustal või modaalaken on lahti, ignoreerime vaatleja sündmusi
      if (document.hidden || document.body.classList.contains('modal-open')) return;

      entries.forEach((entry) => {
        const articleEl = entry.target;
        const articleId = parseInt(articleEl.dataset.id, 10);
        const isRead = articleEl.classList.contains('is-read');

        if (isRead || !articleId) return;

        const rect = entry.boundingClientRect;
        // Artikkel märgitakse loetuks AINULT siis, kui ta on lahkunud vaateväljast ÜLESPOOLE
        // ning tal on reaalne kõrgus (mitte taustal olles 0x0 mõõtmed)
        if (!entry.isIntersecting && rect.height > 0 && rect.bottom <= 50 && rect.top < 50) {
          queueArticleAsRead(articleId, articleEl);
        }
      });
    }, options);

    // Vaatleme kõiki lugemata artikleid
    document.querySelectorAll('.article-item:not(.is-read)').forEach((el) => {
      articleObserver.observe(el);
    });
  }

  // ==========================================================================
  // Tagasi üles kerimise noole haldus (Scroll to Top FAB)
  // ==========================================================================
  function updateScrollTopButton() {
    if (!btnScrollTop) return;

    const scrollY = window.scrollY || document.documentElement.scrollTop;
    // Kui lehe alguses (vähem kui 250px keritud), pole noolt vaja
    if (scrollY <= 250) {
      if (btnScrollTop.classList.contains('visible')) {
        btnScrollTop.classList.remove('visible');
      }
      return;
    }

    const windowHeight = window.innerHeight;
    const scrollHeight = document.documentElement.scrollHeight;
    const distanceToBottom = scrollHeight - (scrollY + windowHeight);

    // Nool kuvatakse ekraani lõppu jõudes: lehe viimase ekraanitäie ulatuses (ei vaja DOM otsinguid)
    const isAtEnd = distanceToBottom <= (windowHeight * 1.15);

    if (isAtEnd) {
      if (!btnScrollTop.classList.contains('visible')) {
        btnScrollTop.classList.add('visible');
      }
    } else {
      if (btnScrollTop.classList.contains('visible')) {
        btnScrollTop.classList.remove('visible');
      }
    }
  }

  if (btnScrollTop) {
    btnScrollTop.addEventListener('click', (e) => {
      e.preventDefault();
      btnScrollTop.classList.remove('visible');

      const isUnreadFeedActive = (!showReadArticles && !isReadLaterView && articlesData && articlesData.length > 0 && !feedContainerEl.classList.contains('has-empty-state'));

      if (isUnreadFeedActive) {
        feedReachedEnd = true;
        markAllRemainingFeedArticlesAsRead();
      }

      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });

      if (isUnreadFeedActive) {
        if (scrollTopArrivalRaf) cancelAnimationFrame(scrollTopArrivalRaf);
        if (scrollTopTimeout) clearTimeout(scrollTopTimeout);

        const checkArrival = () => {
          const y = window.scrollY || document.documentElement.scrollTop;
          if (y <= 30) {
            if (scrollTopArrivalRaf) cancelAnimationFrame(scrollTopArrivalRaf);
            scrollTopArrivalRaf = null;
            if (scrollTopTimeout) {
              clearTimeout(scrollTopTimeout);
              scrollTopTimeout = null;
            }
            triggerEmptyFeedState();
          } else {
            scrollTopArrivalRaf = requestAnimationFrame(checkArrival);
          }
        };
        scrollTopArrivalRaf = requestAnimationFrame(checkArrival);

        scrollTopTimeout = setTimeout(() => {
          if (scrollTopArrivalRaf) {
            cancelAnimationFrame(scrollTopArrivalRaf);
            scrollTopArrivalRaf = null;
          }
          scrollTopTimeout = null;
          if (feedReachedEnd) {
            window.scrollTo({ top: 0, behavior: 'instant' });
            triggerEmptyFeedState();
          }
        }, 900);
      }
    });
  }

  // Lisakontroll kerimisel: kiirel kerimisel debounce'ime loetuks märkimise, et kerimine oleks 100% sujuv
  window.addEventListener('scroll', () => {
    updateScrollTopButton();
    checkFeedScrollPosition();
    clearTimeout(scrollCheckTimeout);
    scrollCheckTimeout = setTimeout(() => {
      checkScrolledPastArticles();
      checkFeedScrollPosition();
    }, 120);
  }, { passive: true });

  // Äppide vahetamisel (taustale minek ja naasmine) kerimisasendi ja järjekorra säilitamine
  let lastActiveScrollY = 0;
  let lastHiddenTime = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      lastActiveScrollY = window.scrollY;
      lastHiddenTime = Date.now();
      flushReadQueue();
    } else {
      // Kui leht naasis taustalt ja brauser tegi anomaalse kerimishüppe lõppu,
      // taastame kasutaja pooleli olnud lugemisasendi
      if (lastActiveScrollY > 0 && Math.abs(window.scrollY - lastActiveScrollY) > 80) {
        window.scrollTo({ top: lastActiveScrollY, behavior: 'instant' });
      }

      // Kui leht naasis taustalt ja oli seal kauem kui 45 sekundit, sünkrooni baasist andmed
      if (currentUser && Date.now() - lastHiddenTime > 45 * 1000) {
        if (window.scrollY <= 80 || (articlesData && articlesData.length === 0)) {
          syncFeedFromDb({ showFeedback: false });
        } else {
          loadSources();
        }
      }
    }
  });

  function queueArticleAsRead(articleId, element) {
    if (element.classList.contains('is-read')) return;
    readQueue.add(articleId);

    // Märgime kohe visuaalselt halliks
    element.classList.add('is-read');
    const checkBtn = element.querySelector('.btn-mark-read');
    if (checkBtn) {
      checkBtn.setAttribute('title', 'Loetud');
    }

    // Uuendame koheselt allika lugemata arvu frontendis
    decrementUnreadCounts(element.dataset.sourceId);

    // Uuenda mälus olevat artiklit
    const numId = parseInt(articleId, 10);
    const artObj = articlesData.find(a => a.id === numId);
    if (artObj) {
      artObj.is_read = 1;
    }

    if (articleObserver) {
      articleObserver.unobserve(element);
    }

    clearTimeout(readQueueTimeout);
    readQueueTimeout = setTimeout(flushReadQueue, 800);
  }

  async function flushReadQueue() {
    if (readQueue.size === 0) return;

    const idsToSend = Array.from(readQueue);

    try {
      const res = await fetch('/api/articles/read-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ article_ids: idsToSend })
      });
      if (res && res.ok) {
        idsToSend.forEach(id => readQueue.delete(id));
      } else {
        console.warn('Server lükkas batch loetuks märkimise tagasi:', res ? res.status : 'puudub vastus');
      }
    } catch (err) {
      console.warn('Võrguviga batch loetuks märkimisel, proovin uuesti:', err);
    }
  }

  function incrementUnreadCounts(sourceId) {
    if (!sourceId) return;

    const numSourceId = parseInt(sourceId, 10);
    const src = sourcesData.find(s => s.id === numSourceId);
    const catId = src ? src.category_id : null;

    // Külgriba allika loendur
    const sourceBadge = document.querySelector(`.nav-badge[data-source-id="${sourceId}"]`);
    if (sourceBadge) {
      let count = parseInt(sourceBadge.textContent, 10) || 0;
      count++;
      sourceBadge.textContent = count;
      sourceBadge.classList.add('has-unread');
    }

    // Kategooria loendur, kui allikas kuulub kategooriasse
    if (catId) {
      const catBadge = document.querySelector(`[data-category-badge-id="${catId}"]`);
      if (catBadge) {
        let catCount = parseInt(catBadge.textContent, 10) || 0;
        catCount++;
        catBadge.textContent = catCount;
        catBadge.classList.add('has-unread');
      }
    }

    // Üldine loendur ("Kõik allikad")
    let total = parseInt(totalUnreadBadgeEl.textContent, 10) || 0;
    total++;
    totalUnreadBadgeEl.textContent = total;
    totalUnreadBadgeEl.classList.add('has-unread');
    const navItemAll = document.getElementById('navItemAll');
    if (navItemAll) navItemAll.title = `Kõik allikad (${total} lugemata)`;

    // Uuenda ka sourcesData mälus
    if (src) {
      src.unread_count = (src.unread_count || 0) + 1;
    }

    // Praeguse vaate loendur kui eksisteerib
    if (currentViewCountEl && !isReadLaterView) {
      let viewCount = parseInt(currentViewCountEl.textContent, 10) || 0;
      currentViewCountEl.textContent = `${viewCount + 1} lugemata`;
    }
  }

  function decrementUnreadCounts(sourceId) {
    if (!sourceId) return;

    const numSourceId = parseInt(sourceId, 10);
    const src = sourcesData.find(s => s.id === numSourceId);
    const catId = src ? src.category_id : null;

    // Külgriba allika loendur
    const sourceBadge = document.querySelector(`.nav-badge[data-source-id="${sourceId}"]`);
    if (sourceBadge) {
      let count = parseInt(sourceBadge.textContent, 10) || 0;
      if (count > 0) {
        count--;
        sourceBadge.textContent = count;
        if (count === 0) {
          sourceBadge.classList.remove('has-unread');
        }
      }
    }

    // Kategooria loendur, kui allikas kuulub kategooriasse
    if (catId) {
      const catBadge = document.querySelector(`[data-category-badge-id="${catId}"]`);
      if (catBadge) {
        let catCount = parseInt(catBadge.textContent, 10) || 0;
        if (catCount > 0) {
          catCount--;
          catBadge.textContent = catCount;
          if (catCount === 0) {
            catBadge.classList.remove('has-unread');
          }
        }
      }
    }

    // Üldine loendur ("Kõik allikad")
    let total = parseInt(totalUnreadBadgeEl.textContent, 10) || 0;
    if (total > 0) {
      total--;
      totalUnreadBadgeEl.textContent = total;
      if (total === 0) {
        totalUnreadBadgeEl.classList.remove('has-unread');
      }
      const navItemAll = document.getElementById('navItemAll');
      if (navItemAll) navItemAll.title = `Kõik allikad (${total} lugemata)`;
    }

    // Uuenda ka sourcesData mälus
    if (src && src.unread_count > 0) {
      src.unread_count--;
    }

    // Praeguse vaate loendur kui eksisteerib
    if (currentViewCountEl && !isReadLaterView) {
      let viewCount = parseInt(currentViewCountEl.textContent, 10) || 0;
      if (viewCount > 0) {
        currentViewCountEl.textContent = `${viewCount - 1} lugemata`;
      }
    }
  }

  function updateReadLaterBadge(count) {
    readLaterCount = count;
    if (readLaterBadgeEl) {
      readLaterBadgeEl.textContent = count;
      if (count > 0) {
        readLaterBadgeEl.classList.add('has-unread');
      } else {
        readLaterBadgeEl.classList.remove('has-unread');
      }
    }
    if (navItemReadLater) {
      navItemReadLater.title = `Loe hiljem (${count})`;
    }
  }

  // ==========================================================================
  // Kategooriate haldus (Categories State & Management)
  // ==========================================================================
  function saveCollapsedCategories() {
    try {
      localStorage.setItem('lugeja_collapsed_categories', JSON.stringify(Array.from(collapsedCategories)));
    } catch (e) {}
  }

  function loadCollapsedCategories() {
    try {
      const saved = localStorage.getItem('lugeja_collapsed_categories');
      if (saved) {
        collapsedCategories = new Set(JSON.parse(saved));
      }
    } catch (e) {}
  }

  async function loadCategories() {
    try {
      const res = await fetch(`/api/categories?_t=${Date.now()}`, { cache: 'no-store' });
      if (res.status === 401) {
        handleAuthRequired();
        return;
      }
      const data = await res.json();
      categoriesData = data.categories || [];
      populateCategorySelects();
    } catch (err) {
      console.error('Viga kategooriate laadimisel:', err);
    }
  }

  function populateCategorySelects() {
    const defaultOpt = '<option value="">-- Ilma kategooriata --</option>';
    const options = categoriesData.map(cat => `<option value="${cat.id}">${escapeHtml(cat.name)}</option>`).join('');
    if (sourceCategorySelect) {
      sourceCategorySelect.innerHTML = defaultOpt + options;
    }
    if (editSourceCategorySelect) {
      editSourceCategorySelect.innerHTML = defaultOpt + options;
    }
  }

  // ==========================================================================
  // Andmete laadimine (Fetch Data)
  // ==========================================================================
  async function loadSources() {
    try {
      const res = await fetch(`/api/sources?_t=${Date.now()}`, { cache: 'no-store' });
      if (res.status === 401) {
        handleAuthRequired();
        return;
      }
      const data = await res.json();
      sourcesData = data.sources || [];
      sourcesLoaded = true;
      if (data.read_later_count !== undefined) {
        updateReadLaterBadge(data.read_later_count);
      }
      renderSources();
      // Kui artiklid on juba laaditud ja nimekiri tühi, re-renderda sööt õige tühioleku teatega
      if (articlesLoaded && (!articlesData || articlesData.length === 0)) {
        renderFeed();
      }
    } catch (err) {
      console.error('Viga allikate laadimisel:', err);
      sourcesLoaded = true;
    }
  }

  function syncSidebarUnreadCountsFromArticles() {
    if (!currentSourceId && !currentCategoryId && !isReadLaterView && !showReadArticles && sourcesData && sourcesData.length > 0) {
      const countsBySource = {};
      (articlesData || []).forEach((art) => {
        if (!art.is_read) {
          countsBySource[art.source_id] = (countsBySource[art.source_id] || 0) + 1;
        }
      });
      sourcesData.forEach((src) => {
        src.unread_count = countsBySource[src.id] || 0;
      });
      renderSources();
    }
  }

  async function loadArticles({ scrollToTop = false } = {}) {
    const newViewKey = `${isReadLaterView ? 'rl' : 'all'}:${currentSourceId ?? ''}:${currentCategoryId ?? ''}:${showReadArticles ? 'read' : 'unread'}`;
    const isViewSwitch = (activeViewKey !== newViewKey);
    const shouldScrollToTop = scrollToTop || isViewSwitch;

    if (shouldScrollToTop) {
      resetFeedScrollPosition();
    } else {
      feedReachedEnd = false;
    }

    try {
      let url;
      if (isReadLaterView) {
        url = '/api/articles?read_later=1';
      } else {
        url = `/api/articles?include_read=${showReadArticles ? 1 : 0}`;
        if (currentSourceId) {
          url += `&source_id=${currentSourceId}`;
        } else if (currentCategoryId) {
          url += `&category_id=${currentCategoryId}`;
        }
      }

      const sep = url.includes('?') ? '&' : '?';
      const res = await fetch(`${url}${sep}_t=${Date.now()}`, { cache: 'no-store' });
      if (res.status === 401) {
        handleAuthRequired();
        return;
      }
      const data = await res.json();
      articlesData = data.articles || [];
      articlesLoaded = true;
      activeViewKey = newViewKey;

      if (shouldScrollToTop) {
        window.scrollTo({ top: 0, behavior: 'instant' });
      }

      renderFeed();

      if (shouldScrollToTop) {
        window.scrollTo({ top: 0, behavior: 'instant' });
      }

      setupIntersectionObserver();
      syncSidebarUnreadCountsFromArticles();
    } catch (err) {
      articlesLoaded = true;
      console.error('Viga artiklite laadimisel:', err);
      feedContainerEl.classList.add('has-empty-state');
      document.body.classList.add('has-empty-feed');
      feedContainerEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-title">Viga artiklite laadimisel</div>
          <div class="empty-desc">Palun kontrolli ühendust ja proovi uuesti.</div>
          <button class="btn btn-primary" id="btnRetryLoadArticles">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
            </svg>
            Proovi uuesti
          </button>
        </div>
      `;
      const btnRetry = document.getElementById('btnRetryLoadArticles');
      if (btnRetry) {
        btnRetry.addEventListener('click', async () => {
          btnRetry.disabled = true;
          btnRetry.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 0.8s linear infinite; color: var(--va-acc);">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
            </svg>
            Laadin...
          `;
          await loadCategories();
          await loadSources();
          await loadArticles({ scrollToTop: true });
        });
      }
    }
  }

  // Ekspordi ka aknale globaalselt igaks juhuks
  window.loadArticles = loadArticles;

  // ==========================================================================
  // Renderdamine (Rendering)
  // ==========================================================================
  function createSourceNavItem(src, isSubItem = false) {
    const btn = document.createElement('button');
    btn.className = `nav-item ${isSubItem ? 'nav-item-sub' : ''} ${currentSourceId === src.id ? 'active' : ''}`;
    btn.dataset.id = src.id;
    btn.title = `${src.name} (${src.unread_count} lugemata)`;

    btn.innerHTML = `
      <div class="nav-item-content">
        <div class="nav-icon">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3">
            <path d="M4 11a9 9 0 0 1 9 9"></path>
            <path d="M4 4a16 16 0 0 1 16 16"></path>
            <circle cx="5" cy="19" r="1"></circle>
          </svg>
        </div>
        <span class="nav-label" title="${escapeHtml(src.name)}">${escapeHtml(src.name)}</span>
      </div>
      <div class="nav-item-right">
        <span class="nav-badge ${src.unread_count > 0 ? 'has-unread' : ''}" data-source-id="${src.id}">
          ${src.unread_count}
        </span>
        <div class="nav-item-actions">
          <button type="button" class="btn-edit-source" title="Muuda allikat" data-edit-id="${src.id}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button type="button" class="btn-delete-source" title="Kustuta allikas" data-delete-id="${src.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>
    `;

    btn.addEventListener('click', (e) => {
      // Kui vajutati kustutamise nupule
      if (e.target.closest('.btn-delete-source')) {
        e.stopPropagation();
        handleDeleteSource(src.id, src.name);
        return;
      }

      // Kui vajutati muutmise nupule
      if (e.target.closest('.btn-edit-source')) {
        e.stopPropagation();
        openEditModal(src);
        return;
      }

      if (currentSourceId === src.id && !isReadLaterView && currentCategoryId === null) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        closeMobileSidebar();
        return;
      }

      currentSourceId = src.id;
      currentCategoryId = null;
      isReadLaterView = false;
      resetFeedScrollPosition();
      updateActiveNav();
      loadArticles({ scrollToTop: true });
      closeMobileSidebar();
    });

    return btn;
  }

  function renderSources() {
    sourcesListEl.innerHTML = '';
    let totalUnread = 0;

    sourcesData.forEach((src) => {
      totalUnread += (src.unread_count || 0);
    });

    // 1. Kategooriad koos nende all olevate allikatega
    const knownCatIds = new Set();

    categoriesData.forEach((cat) => {
      knownCatIds.add(cat.id);
      const catSources = sourcesData.filter((s) => s.category_id === cat.id);
      const catUnread = catSources.reduce((sum, s) => sum + (s.unread_count || 0), 0);
      const isCollapsed = collapsedCategories.has(cat.id);

      const groupEl = document.createElement('div');
      groupEl.className = `category-group ${isCollapsed ? 'collapsed' : ''}`;
      groupEl.dataset.catId = cat.id;

      const headerEl = document.createElement('div');
      headerEl.className = `category-header ${(!isReadLaterView && currentSourceId === null && currentCategoryId === cat.id) ? 'active' : ''}`;
      headerEl.dataset.categoryId = cat.id;

      headerEl.innerHTML = `
        <div class="category-left">
          <button type="button" class="category-chevron-btn" title="${isCollapsed ? 'Ava kategooria' : 'Ahenda kategooria'}" aria-label="Ava või ahenda kategooria">
            <svg class="category-chevron-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <button type="button" class="category-title-btn" title="${escapeHtml(cat.name)} (${catUnread} lugemata)">
            <svg class="category-folder-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
            <span class="category-name-text">${escapeHtml(cat.name)}</span>
          </button>
        </div>
        <div class="category-right">
          <span class="nav-badge ${catUnread > 0 ? 'has-unread' : ''}" data-category-badge-id="${cat.id}">
            ${catUnread}
          </span>
          <div class="category-actions">
            <button type="button" class="btn-cat-action btn-cat-edit" title="Muuda kategooriat" data-cat-id="${cat.id}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
            </button>
            <button type="button" class="btn-cat-action btn-cat-delete" title="Kustuta kategooria" data-cat-id="${cat.id}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
      `;

      // Chevron ahendamine/avamine
      const chevronBtn = headerEl.querySelector('.category-chevron-btn');
      chevronBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const willCollapse = !groupEl.classList.contains('collapsed');
        groupEl.classList.toggle('collapsed', willCollapse);
        if (willCollapse) {
          collapsedCategories.add(cat.id);
          chevronBtn.title = 'Ava kategooria';
        } else {
          collapsedCategories.delete(cat.id);
          chevronBtn.title = 'Ahenda kategooria';
        }
        saveCollapsedCategories();
      });

      // Kategooria filtri valik
      const titleBtn = headerEl.querySelector('.category-title-btn');
      titleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentCategoryId === cat.id && currentSourceId === null && !isReadLaterView) {
          window.scrollTo({ top: 0, behavior: 'smooth' });
          closeMobileSidebar();
          return;
        }
        currentCategoryId = cat.id;
        currentSourceId = null;
        isReadLaterView = false;
        resetFeedScrollPosition();
        updateActiveNav();
        loadArticles({ scrollToTop: true });
        closeMobileSidebar();
      });

      // Muutmine ja kustutamine
      const editBtn = headerEl.querySelector('.btn-cat-edit');
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditCategoryModal(cat);
      });

      const delBtn = headerEl.querySelector('.btn-cat-delete');
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openDeleteCategoryModal(cat);
      });

      groupEl.appendChild(headerEl);

      // Kategooria allikate loend
      const sourcesList = document.createElement('div');
      sourcesList.className = 'category-sources-list';
      catSources.forEach((src) => {
        sourcesList.appendChild(createSourceNavItem(src, true));
      });
      groupEl.appendChild(sourcesList);

      sourcesListEl.appendChild(groupEl);
    });

    // 2. Ilma kategooriata allikad (tulevad otse kategooriate nimekirja alla ilma vahepealkirjata)
    const uncategorized = sourcesData.filter((s) => !s.category_id || !knownCatIds.has(s.category_id));
    if (uncategorized.length > 0) {
      uncategorized.forEach((src) => {
        sourcesListEl.appendChild(createSourceNavItem(src, false));
      });
    }

    // Uuenda "Kõik" badge
    totalUnreadBadgeEl.textContent = totalUnread;
    if (totalUnread > 0) {
      totalUnreadBadgeEl.classList.add('has-unread');
    } else {
      totalUnreadBadgeEl.classList.remove('has-unread');
    }
    const navItemAll = document.getElementById('navItemAll');
    if (navItemAll) {
      navItemAll.title = `Kõik allikad (${totalUnread} lugemata)`;
    }

    const exportWrap = document.querySelector('.sidebar-export-wrap');
    if (exportWrap) {
      exportWrap.style.display = sourcesData.length > 0 ? 'block' : 'none';
    }

    updateHeaderTitle();
  }

  function updateActiveNav() {
    document.querySelectorAll('.sidebar-nav .nav-item').forEach((item) => {
      const isAll = item.dataset.filter === 'all';
      const isReadLater = item.dataset.filter === 'read_later';
      const itemId = parseInt(item.dataset.id, 10);

      if (isReadLaterView && isReadLater) {
        item.classList.add('active');
      } else if (!isReadLaterView && currentSourceId === null && currentCategoryId === null && isAll) {
        item.classList.add('active');
      } else if (!isReadLaterView && currentSourceId === itemId) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    document.querySelectorAll('.category-header').forEach((catHeader) => {
      const catId = parseInt(catHeader.dataset.categoryId, 10);
      if (!isReadLaterView && currentSourceId === null && currentCategoryId === catId) {
        catHeader.classList.add('active');
      } else {
        catHeader.classList.remove('active');
      }
    });

    updateHeaderTitle();
  }

  function updateHeaderTitle() {
    if (!currentViewTitleEl) return;
    if (isReadLaterView) {
      currentViewTitleEl.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
        </svg>
        Loe hiljem
      `;
    } else if (currentCategoryId !== null) {
      const cat = categoriesData.find((c) => c.id === currentCategoryId);
      const name = cat ? cat.name : 'Kategooria';
      currentViewTitleEl.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>
        ${escapeHtml(name)}
      `;
    } else if (currentSourceId === null) {
      currentViewTitleEl.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 11a9 9 0 0 1 9 9"></path>
          <path d="M4 4a16 16 0 0 1 16 16"></path>
          <circle cx="5" cy="19" r="1"></circle>
        </svg>
        Kõik uudised
      `;
    } else {
      const src = sourcesData.find((s) => s.id === currentSourceId);
      const name = src ? src.name : 'Allikas';
      currentViewTitleEl.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 11a9 9 0 0 1 9 9"></path>
          <path d="M4 4a16 16 0 0 1 16 16"></path>
          <circle cx="5" cy="19" r="1"></circle>
        </svg>
        ${escapeHtml(name)}
      `;
    }
  }

  function renderFeed() {
    feedContainerEl.innerHTML = '';

    if (!articlesData || articlesData.length === 0) {
      feedContainerEl.classList.add('has-empty-state');
      document.body.classList.add('has-empty-feed');
      const hasNoSources = (!isReadLaterView && sourcesLoaded && sourcesData.length === 0);
      const emptyTitle = isReadLaterView 
        ? 'Hiljem lugemiseks salvestatud artikleid ei ole' 
        : (hasNoSources ? 'Ühtegi allikat ei leitud' : 'Uudiseid pole praegu kuvada');
      const emptyDesc = isReadLaterView 
        ? 'Klõpsa uudise juures järjehoidja ikoonile, et lisada see siia nimekirja.' 
        : (hasNoSources ? 'Uudiste lugemiseks lisa esmalt mõni allikas.' : 'Kõik artiklid on loetud või uusi lugusid pole veel lisandunud.');

      feedContainerEl.innerHTML = `
        <div class="empty-state">
          <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            ${isReadLaterView 
              ? '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>' 
              : (hasNoSources 
                ? '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>' 
                : '<circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line>')}
          </svg>
          <div class="empty-title">${emptyTitle}</div>
          <div class="empty-desc">${emptyDesc}</div>
          ${hasNoSources 
            ? '<button class="btn btn-primary" id="btnEmptyAddSource" style="margin-top: 14px;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Lisa allikas</button>' 
            : (!isReadLaterView ? '<button class="btn btn-secondary" id="btnEmptyRefresh" style="margin-top: 14px;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--va-acc);"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg> Värskenda kohe</button>' : '')}
        </div>
      `;
      const btnEmptyAddSource = feedContainerEl.querySelector('#btnEmptyAddSource');
      if (btnEmptyAddSource) {
        btnEmptyAddSource.addEventListener('click', () => {
          document.getElementById('btnAddSourceChoice')?.click() || document.getElementById('btnOpenAddDropdown')?.click();
        });
      }
      const btnEmptyRefresh = feedContainerEl.querySelector('#btnEmptyRefresh');
      if (btnEmptyRefresh) {
        btnEmptyRefresh.addEventListener('click', async () => {
          btnEmptyRefresh.disabled = true;
          const origHtml = btnEmptyRefresh.innerHTML;
          btnEmptyRefresh.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 0.8s linear infinite; color: var(--va-acc);">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
            </svg>
            Sünkroonin...
          `;
          try {
            await syncFeedFromDb({ showFeedback: true });
          } finally {
            if (btnEmptyRefresh) {
              btnEmptyRefresh.disabled = false;
              btnEmptyRefresh.innerHTML = origHtml;
            }
          }
        });
      }
      if (currentViewCountEl) currentViewCountEl.textContent = isReadLaterView ? '0 salvestatud' : '0 lugemata';
      updateScrollTopButton();
      return;
    }

    feedContainerEl.classList.remove('has-empty-state');
    document.body.classList.remove('has-empty-feed');

    // Loendur päises kui eksisteerib
    if (isReadLaterView) {
      if (currentViewCountEl) currentViewCountEl.textContent = `${articlesData.length} salvestatud`;
    } else {
      const unreadCount = articlesData.filter((a) => !a.is_read).length;
      if (currentViewCountEl) currentViewCountEl.textContent = `${unreadCount} lugemata`;
    }

    // Grupeerime artiklid allikate kaupa vastavalt spetsifikatsioonile:
    // "sorteerituna kõigepealt andmeallikate kaupa ja nende lõikes kuupäeva ja kellaaja järgi"
    const grouped = {};
    articlesData.forEach((art) => {
      const srcName = art.source_name || 'Muud allikad';
      if (!grouped[srcName]) {
        grouped[srcName] = {
          source_name: srcName,
          source_logo: art.source_logo,
          source_id: art.source_id,
          articles: []
        };
      }
      grouped[srcName].articles.push(art);
    });

    // Koostame HTML struktuuri igale grupile
    Object.values(grouped).forEach((group) => {
      const groupEl = document.createElement('section');
      groupEl.className = 'source-group';

      groupEl.innerHTML = `
        <div class="source-group-header">
          <div class="source-info">
            <div class="source-logo-container">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3">
                <path d="M4 11a9 9 0 0 1 9 9"></path>
                <path d="M4 4a16 16 0 0 1 16 16"></path>
                <circle cx="5" cy="19" r="1"></circle>
              </svg>
            </div>
            <span class="source-name">${escapeHtml(group.source_name)}</span>
            <span class="source-type-pill">${group.articles.length} artiklit</span>
          </div>
          <div class="source-actions">
            <button class="btn btn-secondary btn-icon-only btn-group-mark-read" title="Märgi selle allika lood loetuks" data-source-id="${group.source_id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </button>
          </div>
        </div>
        <div class="source-articles-list"></div>
      `;

      // Grupist loetuks märkimise sündmus
      groupEl.querySelector('.btn-group-mark-read').addEventListener('click', async (e) => {
        const sId = e.currentTarget.dataset.sourceId;
        if (isReadLaterView) {
          const res = await fetch(`/api/articles/read-all?source_id=${sId}&read_later=1`, { method: 'POST' });
          const data = await res.json();
          if (data.affected > 0) {
            showToast(`Allika "${group.source_name}" salvestatud lood märgitud loetuks (${data.affected})`);
          } else {
            showToast(`Kõik allika "${group.source_name}" salvestatud lood on juba loetud`);
          }
        } else {
          await fetch(`/api/articles/read-all?source_id=${sId}`, { method: 'POST' });
          showToast(`Allika "${group.source_name}" lood märgitud loetuks`);
        }
        await loadSources();
        await loadArticles();
      });

      const listEl = groupEl.querySelector('.source-articles-list');

      group.articles.forEach((art) => {
        const artEl = document.createElement('article');
        artEl.className = `article-item ${art.is_read ? 'is-read' : ''}`;
        artEl.dataset.id = art.id;
        artEl.dataset.sourceId = art.source_id;

        const timeFormatted = formatDateTime(art.published_at);
        const safeArtUrl = sanitizeUrl(art.url);
        const safeImgUrl = sanitizeImageUrl(art.image_url);
        const hasThumb = Boolean(safeImgUrl);

        artEl.innerHTML = `
          <div class="article-main">
            <a class="article-title-link" href="${escapeHtml(safeArtUrl)}" target="_blank" rel="noopener noreferrer">
              ${escapeHtml(art.title)}
            </a>
            <div class="article-meta">
              <span class="article-time" title="${escapeHtml(art.published_at)}">${escapeHtml(timeFormatted)}</span>
              <div class="article-actions">
                <button class="btn-read-later ${art.is_read_later ? 'active' : ''}" title="${art.is_read_later ? 'Eemalda hiljem lugemisest' : 'Loe hiljem'}" data-id="${art.id}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="${art.is_read_later ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
                  </svg>
                </button>
                <button class="btn-mark-read" title="${art.is_read ? 'Loetud' : 'Märgi loetuks'}" data-id="${art.id}">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </button>
              </div>
            </div>
          </div>
          ${hasThumb ? `
            <a class="article-thumb-link" href="${escapeHtml(safeArtUrl)}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true" title="${escapeHtml(art.title)}">
              <img class="article-thumb" src="${escapeHtml(safeImgUrl)}" alt="" loading="lazy" decoding="async" onerror="this.closest('.article-thumb-link').style.display='none'">
            </a>
          ` : ''}
        `;

        // Nupuvajutus "Loe hiljem"
        const readLaterBtn = artEl.querySelector('.btn-read-later');
        readLaterBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          handleToggleReadLater(art.id, artEl);
        });

        // Manuaalne nupuvajutus "Märgi loetuks"
        const markBtn = artEl.querySelector('.btn-mark-read');
        markBtn.addEventListener('click', () => handleManualMarkRead(art.id, artEl));

        // Kui kasutaja vajutab pealkirjale või pisipildile, märgime reaalselt avatuks
        const titleLink = artEl.querySelector('.article-title-link');
        const thumbLink = artEl.querySelector('.article-thumb-link');
        const onArticleClick = () => handleArticleOpen(art.id, artEl);
        titleLink.addEventListener('click', onArticleClick);
        if (thumbLink) {
          thumbLink.addEventListener('click', onArticleClick);
        }

        listEl.appendChild(artEl);
      });

      feedContainerEl.appendChild(groupEl);
    });

    updateScrollTopButton();
  }

  // ==========================================================================
  // Sündmuste käsitlejad (Actions)
  // ==========================================================================

  // Artikli eraldi avamine (klikkimine pealkirjal või pildil reaalseks lugemiseks)
  async function handleArticleOpen(articleId, element) {
    const numId = parseInt(articleId, 10);
    const sourceId = element ? element.dataset.sourceId : null;
    const markBtn = element ? element.querySelector('.btn-mark-read') : null;

    if (element && !element.classList.contains('is-read')) {
      element.classList.add('is-read');
      if (markBtn) markBtn.setAttribute('title', 'Loetud');
      if (sourceId) decrementUnreadCounts(sourceId);
      if (articleObserver) {
        articleObserver.unobserve(element);
      }
    }

    if (readQueue.has(numId)) {
      readQueue.delete(numId);
    }

    const artObj = articlesData.find(a => a.id === numId);
    if (artObj) {
      artObj.is_read = 1;
      artObj.is_opened = 1;
    }

    try {
      const dev = isMobileDevice() ? 'mobile' : 'desktop';
      await fetch(`/api/articles/${articleId}/open`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Type': dev
        },
        body: JSON.stringify({ device: dev })
      });
    } catch (err) {
      console.warn('Viga artikli avatuks märkimisel:', err);
    }
  }

  // Manuaalne artikli loetuks märkimine ja tagasivõtmine
  async function handleManualMarkRead(articleId, element) {
    const isCurrentlyRead = element.classList.contains('is-read');
    const newStatus = !isCurrentlyRead;
    const sourceId = element.dataset.sourceId;
    const markBtn = element.querySelector('.btn-mark-read');
    const numId = parseInt(articleId, 10);

    // Kohene visuaalne ja loendurite tagasiside
    if (newStatus) {
      element.classList.add('is-read');
      if (markBtn) markBtn.setAttribute('title', 'Loetud');
      decrementUnreadCounts(sourceId);
      if (articleObserver) {
        articleObserver.unobserve(element);
      }
    } else {
      element.classList.remove('is-read');
      if (markBtn) markBtn.setAttribute('title', 'Märgi loetuks');
      incrementUnreadCounts(sourceId);
      if (articleObserver) {
        articleObserver.observe(element);
      }
    }

    // Uuenda mälus olevat artiklit
    const artObj = articlesData.find(a => a.id === numId);
    if (artObj) {
      artObj.is_read = newStatus ? 1 : 0;
    }

    // Kui võeti loetuks märkimine tagasi, eemalda batch järjekorrast
    if (!newStatus && readQueue.has(numId)) {
      readQueue.delete(numId);
    }

    try {
      await fetch(`/api/articles/${articleId}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_read: newStatus ? 1 : 0 })
      });
    } catch (err) {
      console.warn('Viga loetuks märkimisel:', err);
    }
  }

  // Artikli lisamine hiljem lugemiseks ja tagasivõtmine
  async function handleToggleReadLater(articleId, element) {
    const readLaterBtn = element.querySelector('.btn-read-later');
    const isCurrentlyReadLater = readLaterBtn.classList.contains('active');
    const newStatus = !isCurrentlyReadLater;
    const numId = parseInt(articleId, 10);

    // Kohene visuaalne tagasiside
    readLaterBtn.classList.toggle('active', newStatus);
    readLaterBtn.title = newStatus ? 'Eemalda hiljem lugemisest' : 'Loe hiljem';
    const svgIcon = readLaterBtn.querySelector('svg');
    if (svgIcon) {
      svgIcon.setAttribute('fill', newStatus ? 'currentColor' : 'none');
    }

    // Uuenda mälus olevat artiklit
    const artObj = articlesData.find(a => a.id === numId);
    if (artObj) {
      artObj.is_read_later = newStatus ? 1 : 0;
    }

    // Kui oleme "Loe hiljem" vaates ja kasutaja eemaldab artikli hiljem lugemisest
    if (isReadLaterView && !newStatus) {
      element.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
      element.style.opacity = '0';
      element.style.transform = 'translateX(20px)';
      setTimeout(() => {
        const parentList = element.parentElement;
        element.remove();
        if (parentList && parentList.children.length === 0) {
          const groupEl = parentList.closest('.source-group');
          if (groupEl) groupEl.remove();
        }
        articlesData = articlesData.filter(a => a.id !== numId);
        if (feedContainerEl.children.length === 0) {
          renderFeed();
        } else if (currentViewCountEl) {
          currentViewCountEl.textContent = `${articlesData.length} salvestatud`;
        }
      }, 250);
    }

    try {
      const res = await fetch(`/api/articles/${articleId}/read-later`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_read_later: newStatus ? 1 : 0 })
      });
      const data = await res.json();
      if (data.read_later_count !== undefined) {
        updateReadLaterBadge(data.read_later_count);
      }
      showToast(newStatus ? 'Lisatud hiljem lugemiseks' : 'Eemaldatud hiljem lugemisest');
    } catch (err) {
      console.warn('Viga hiljem lugemiseks märkimisel:', err);
    }
  }

  // ==========================================================================
  // Kiire andmebaasi sünkroonimine (SQLite / Turso) ilma veebikraapimiseta
  // Kasutatakse Pull-to-refresh žestil, tühja vaate nupust ja automaatsel intervallil
  // ==========================================================================
  async function syncFeedFromDb({ showFeedback = true, scrollToTop = false } = {}) {
    if (isUpdating) return;
    isUpdating = true;

    if (statusIndicatorEl) {
      statusIndicatorEl.innerHTML = `<span class="status-dot updating"></span> Sünkroonin...`;
    }

    try {
      await Promise.all([loadCategories(), loadSources()]);
      await loadArticles({ scrollToTop });
      renderSources();
      if (scrollToTop) {
        window.scrollTo({ top: 0, behavior: 'instant' });
      }
      if (showFeedback) {
        showToast('Andmebaas sünkroonitud');
      }
    } catch (err) {
      console.error('Viga andmebaasi sünkroonimisel:', err);
      if (showFeedback) {
        showToast('Sünkroonimine ebaõnnestus', 'error');
      }
    } finally {
      isUpdating = false;
      if (statusIndicatorEl) {
        statusIndicatorEl.innerHTML = `<span class="status-dot"></span> Reaalajas`;
      }
    }
  }

  // Täielik allikate veebikraapimine (Käsitsi päisenupust või 'r' klahviga)
  async function handleRefresh() {
    feedReachedEnd = false;
    if (!sourcesData || sourcesData.length === 0) {
      showToast('Ühtegi allikat ei leitud', 'error');
      return;
    }
    if (isUpdating) return;
    isUpdating = true;

    refreshIcon.style.animation = 'spin 0.8s linear infinite';
    btnRefresh.classList.add('loading');
    if (statusIndicatorEl) {
      statusIndicatorEl.innerHTML = `<span class="status-dot updating"></span> Uuendan...`;
    }

    try {
      let refreshUrl = '/api/refresh';
      if (currentSourceId) {
        refreshUrl += `?source_id=${currentSourceId}`;
      }

      const res = await fetch(refreshUrl, { method: 'POST' });
      const rawText = await res.text();
      let data = {};
      try {
        data = JSON.parse(rawText);
      } catch (parseErr) {
        console.error('Serveri vastus ei ole JSON:', res.status, rawText);
        if (res.status === 502) {
          throw new Error('Server ärkab unest (502). Palun oota mõni sekund ja proovi uuesti!');
        } else if (res.status === 504) {
          throw new Error('Serveri ajalõpp (504). Palun proovi uuesti.');
        }
        const snippet = rawText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
        throw new Error(`Serveri viga (${res.status}): ${snippet || 'Vastuse viga'}`);
      }

      if (!res.ok || data.success === false) {
        if (data.no_sources) {
          showToast(data.message || 'Ühtegi allikat ei leitud', 'error');
          return;
        }
        throw new Error(data.message || 'Uuendamine ebaõnnestus');
      }

      // Ootame kuni taustauuendus lõpeb (esimesed korrad tihedamalt 600ms, et reageerida koheselt)
      let finalResult = null;
      for (let i = 0; i < 40; i++) {
        const delay = i < 6 ? 600 : 1200;
        await new Promise(r => setTimeout(r, delay));
        try {
          const stRes = await fetch('/api/refresh/status');
          if (stRes.ok) {
            const stData = await stRes.json();
            if (!stData.is_refreshing) {
              finalResult = stData.last_result;
              break;
            }
          }
        } catch (e) {
          // ignoreerime üksikuid võrguvigu
        }
      }

      await loadSources();
      await loadArticles();
      window.scrollTo({ top: 0, behavior: 'instant' });

      if (finalResult && finalResult.new_articles > 0) {
        showToast(`Leitud ${finalResult.new_articles} uut uudist!`);
      } else {
        showToast('Kõik allikad on ajakohased');
      }
    } catch (err) {
      console.error('Viga uuendamisel:', err);
      showToast(err.message || 'Uuendamine ebaõnnestus', 'error');
    } finally {
      isUpdating = false;
      refreshIcon.style.animation = 'none';
      btnRefresh.classList.remove('loading');
      if (statusIndicatorEl) {
        statusIndicatorEl.innerHTML = `<span class="status-dot"></span> Reaalajas`;
      }
    }
  }

  // Märgi kõik loetuks
  async function handleMarkAllRead() {
    if (!sourcesData || sourcesData.length === 0) {
      if (btnMarkAllRead) {
        btnMarkAllRead.classList.add('shake');
        setTimeout(() => btnMarkAllRead.classList.remove('shake'), 400);
      }
      showToast('Ühtegi allikat ei leitud', 'error');
      return;
    }
    if (isMarkingAllRead) return;
    isMarkingAllRead = true;

    // Õrn värviline tagasiside nupule (sarnaselt teiste päisenuppudega)
    if (btnMarkAllRead) {
      btnMarkAllRead.classList.add('active');
    }

    try {
      if (isReadLaterView) {
        let unreadCount = 0;
        try {
          const res = await fetch('/api/articles/read-all?read_later=1', { method: 'POST' });
          const data = await res.json();
          unreadCount = data.affected || 0;
        } catch (e) {
          // Varulahendusena read-batch
          const unreadIds = articlesData.filter(a => !a.is_read).map(a => a.id);
          if (unreadIds.length > 0) {
            const bRes = await fetch('/api/articles/read-batch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ article_ids: unreadIds, ids: unreadIds })
            });
            const bData = await bRes.json();
            unreadCount = bData.affected || unreadIds.length;
          }
        }

        if (unreadCount > 0) {
          showToast(`Märgitud ${unreadCount} salvestatud uudist loetuks`);
        } else {
          showToast('Kõik salvestatud uudised on juba loetud');
        }
        await loadSources();
        await loadArticles();
        return;
      }

      let url = '/api/articles/read-all';
      if (currentSourceId) {
        url += `?source_id=${currentSourceId}`;
      } else if (currentCategoryId) {
        url += `?category_id=${currentCategoryId}`;
      }

      const res = await fetch(url, { method: 'POST' });
      const data = await res.json();

      if (data.affected === 0) {
        showToast('0 uudist loetuks märgitud');
      } else {
        showToast(`Märgitud ${data.affected} uudist loetuks`);
      }
      await loadSources();
      await loadArticles();
    } catch (err) {
      console.error('Viga kõigi loetuks märkimisel:', err);
      showToast('Viga kõigi loetuks märkimisel', 'error');
    } finally {
      setTimeout(() => {
        if (btnMarkAllRead) {
          btnMarkAllRead.classList.remove('active');
        }
      }, 300);
      isMarkingAllRead = false;
    }
  }

  // Kustuta allikas (kinnituse dialoog)
  function handleDeleteSource(sourceId, sourceName) {
    pendingDeleteSource = { id: sourceId, name: sourceName };
    if (deleteSourceNameEl) {
      deleteSourceNameEl.textContent = `"${sourceName}"`;
    }
    if (deleteSourceModal) {
      deleteSourceModal.classList.add('open');
      if (btnCancelDeleteSource) btnCancelDeleteSource.focus();
    }
  }

  function closeDeleteModal() {
    if (deleteSourceModal) {
      deleteSourceModal.classList.remove('open');
    }
    pendingDeleteSource = null;
  }

  async function handleConfirmDeleteSource() {
    if (!pendingDeleteSource) return;
    const { id: sourceId, name: sourceName } = pendingDeleteSource;

    btnConfirmDeleteSource.disabled = true;
    btnConfirmDeleteSource.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 0.8s linear infinite;">
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
      </svg>
      Kustutan...
    `;

    try {
      const res = await fetch(`/api/sources/${sourceId}`, { method: 'DELETE' });
      if (res.ok) {
        showToast(`Allikas "${sourceName}" eemaldatud`);
        closeDeleteModal();
        if (currentSourceId === sourceId) {
          currentSourceId = null;
          resetFeedScrollPosition();
        }
        await loadSources();
        await loadArticles({ scrollToTop: true });
      } else {
        showToast('Allika kustutamine ebaõnnestus', 'error');
      }
    } catch (err) {
      console.error('Viga allika kustutamisel:', err);
      showToast('Viga ühendusel serveriga', 'error');
    } finally {
      btnConfirmDeleteSource.disabled = false;
      btnConfirmDeleteSource.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
        Kustuta allikas
      `;
    }
  }

  // ==========================================================================
  // Modaalakende taustakerimise lukustus (Modal Scroll Lock)
  // Takistab hiirerulliga või puutega taustalehe kerimist ja uudiste loetuks märkimist
  // ==========================================================================
  // Kontrollime, kas element modaali sees on antud suunas keritav (peamiselt töölaua hiirerulli jaoks)
  function isModalElementScrollable(el, deltaY) {
    const scrollContainer = el ? el.closest('.modal-body, .user-profile-body, .sidebar-nav') : null;
    if (scrollContainer && scrollContainer.scrollHeight > scrollContainer.clientHeight) {
      const atTop = scrollContainer.scrollTop <= 0 && deltaY < 0;
      const atBottom = (scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 1) && deltaY > 0;
      if (!atTop && !atBottom) {
        return true; // Sisu sees saab veel kerida
      }
    }
    return false;
  }

  function handleModalWheel(e) {
    if (!isModalElementScrollable(e.target, e.deltaY)) {
      e.preventDefault();
    }
  }

  function handleModalTouchMove(e) {
    // Kui puudutus toimub modaali sisu sees või külgriba sees, laseme brauseri natiivsel puutekerimisel alati 100% sujuvalt toimida
    if (e.target.closest('.modal-content') || e.target.closest('.sidebar')) {
      return;
    }
    // Kui puudutus on taustakattel (modal-backdrop või sidebar-overlay), tõkestame taustalehe kerimise täielikult
    if (e.cancelable) {
      e.preventDefault();
    }
  }

  let isModalLockListenersAttached = false;
  function updateModalScrollLock() {
    const isMobileMenuOpen = window.innerWidth <= 900 && sidebar && sidebar.classList.contains('mobile-open');
    const hasOpenModal = document.querySelector('.modal-backdrop.open') !== null ||
                         (authOverlay && authOverlay.style.display !== 'none') ||
                         isMobileMenuOpen;
    if (hasOpenModal) {
      if (!document.body.classList.contains('modal-open')) {
        document.body.classList.add('modal-open');
        document.documentElement.classList.add('modal-open');
      }
      if (!isModalLockListenersAttached) {
        window.addEventListener('wheel', handleModalWheel, { passive: false });
        window.addEventListener('touchmove', handleModalTouchMove, { passive: false });
        isModalLockListenersAttached = true;
      }
    } else {
      if (document.body.classList.contains('modal-open')) {
        document.body.classList.remove('modal-open');
        document.documentElement.classList.remove('modal-open');
      }
      if (isModalLockListenersAttached) {
        window.removeEventListener('wheel', handleModalWheel, { passive: false });
        window.removeEventListener('touchmove', handleModalTouchMove, { passive: false });
        isModalLockListenersAttached = false;
      }
    }
  }

  // Automaatne jälgimine MutationObserver abil
  const modalScrollObserver = new MutationObserver(() => {
    updateModalScrollLock();
  });

  document.querySelectorAll('.modal-backdrop').forEach((el) => {
    modalScrollObserver.observe(el, { attributes: true, attributeFilter: ['class'] });
  });

  if (authOverlay) {
    modalScrollObserver.observe(authOverlay, { attributes: true, attributeFilter: ['style', 'class'] });
  }

  if (sidebar) {
    modalScrollObserver.observe(sidebar, { attributes: true, attributeFilter: ['class'] });
  }

  // ==========================================================================
  // Modaalide veateadete abifunktsioonid
  // ==========================================================================
  function setModalError(bannerElId, msg) {
    const banner = document.getElementById(bannerElId);
    if (!banner) return;
    if (msg) {
      banner.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="flex-shrink:0;">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <span>${escapeHtml(msg)}</span>
      `;
      banner.style.display = 'flex';
    } else {
      banner.innerHTML = '';
      banner.style.display = 'none';
    }
  }

  // ==========================================================================
  // Uue allika lisamise modaal
  // ==========================================================================
  const sourceUrlInput = document.getElementById('sourceUrl');

  function clearAddSourceErrors() {
    setFieldError(sourceUrlInput, 'sourceUrlError', '');
    setModalError('addSourceErrorBanner', '');
  }

  function openAddModal() {
    clearAddSourceErrors();
    addSourceModal.classList.add('open');
    if (sourceCategorySelect) {
      sourceCategorySelect.value = '';
    }
    if (sourceUrlInput) {
      sourceUrlInput.focus();
    }
  }

  function closeAddModal() {
    addSourceModal.classList.remove('open');
    clearAddSourceErrors();
    addSourceForm.reset();
  }

  if (sourceUrlInput) {
    sourceUrlInput.addEventListener('input', () => {
      setFieldError(sourceUrlInput, 'sourceUrlError', '');
      setModalError('addSourceErrorBanner', '');
    });
  }

  addSourceForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAddSourceErrors();

    const urlInput = sourceUrlInput ? sourceUrlInput.value.trim() : '';
    const nameInput = document.getElementById('sourceName') ? document.getElementById('sourceName').value.trim() : '';
    const catVal = sourceCategorySelect ? sourceCategorySelect.value : '';
    const categoryId = catVal ? parseInt(catVal, 10) : null;

    if (!urlInput) {
      setFieldError(sourceUrlInput, 'sourceUrlError', 'Palun sisesta allika veebiaadress või RSS voog');
      if (sourceUrlInput) sourceUrlInput.focus();
      return;
    }

    btnSubmitSource.disabled = true;
    btnSubmitSource.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 0.8s linear infinite;">
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
      </svg>
      Tuvastan allikat...
    `;

    try {
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput, name: nameInput, category_id: categoryId })
      });

      const data = await res.json();
      if (!res.ok) {
        setFieldError(sourceUrlInput, 'sourceUrlError', data.error || 'Allika lisamine ebaõnnestus');
        setModalError('addSourceErrorBanner', data.error || 'Allika lisamine ebaõnnestus');
        if (sourceUrlInput) sourceUrlInput.focus();
      } else {
        showToast(`Allikas "${data.source.name}" edukalt lisatud!`);
        closeAddModal();
        currentSourceId = data.source.id;
        currentCategoryId = null;
        showReadArticles = false;
        resetFeedScrollPosition();
        if (btnToggleRead) {
          btnToggleRead.classList.remove('active');
          btnToggleRead.title = 'Kuva ka loetud uudised';
        }
        await loadSources();
        await loadArticles({ scrollToTop: true });
      }
    } catch (err) {
      console.error('Viga allika lisamisel:', err);
      setModalError('addSourceErrorBanner', 'Serveri viga allika lisamisel');
    } finally {
      btnSubmitSource.disabled = false;
      btnSubmitSource.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        Lisa allikas
      `;
    }
  });

  // ==========================================================================
  // Allika muutmise modaal
  // ==========================================================================
  function clearEditSourceErrors() {
    setFieldError(editSourceNameInput, 'editSourceNameError', '');
    setFieldError(editSourceUrlInput, 'editSourceUrlError', '');
    setModalError('editSourceErrorBanner', '');
  }

  function openEditModal(source) {
    if (!source) return;
    clearEditSourceErrors();
    editSourceIdInput.value = source.id;
    editSourceNameInput.value = source.name;
    editSourceUrlInput.value = source.url;
    if (editSourceCategorySelect) {
      editSourceCategorySelect.value = source.category_id !== null && source.category_id !== undefined ? String(source.category_id) : '';
    }
    editSourceModal.classList.add('open');
    editSourceNameInput.focus();
  }

  function closeEditModal() {
    editSourceModal.classList.remove('open');
    clearEditSourceErrors();
    editSourceForm.reset();
  }

  if (editSourceNameInput) {
    editSourceNameInput.addEventListener('input', () => {
      setFieldError(editSourceNameInput, 'editSourceNameError', '');
      setModalError('editSourceErrorBanner', '');
    });
  }
  if (editSourceUrlInput) {
    editSourceUrlInput.addEventListener('input', () => {
      setFieldError(editSourceUrlInput, 'editSourceUrlError', '');
      setModalError('editSourceErrorBanner', '');
    });
  }

  editSourceForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearEditSourceErrors();

    const sourceId = editSourceIdInput.value;
    const name = editSourceNameInput.value.trim();
    const url = editSourceUrlInput.value.trim();
    const catVal = editSourceCategorySelect ? editSourceCategorySelect.value : '';
    const categoryId = catVal ? parseInt(catVal, 10) : null;

    let hasErr = false;
    if (!name) {
      setFieldError(editSourceNameInput, 'editSourceNameError', 'Palun sisesta allika nimi');
      hasErr = true;
    }
    if (!url) {
      setFieldError(editSourceUrlInput, 'editSourceUrlError', 'Palun sisesta allika veebiaadress või RSS voog');
      hasErr = true;
    }
    if (hasErr) {
      if (!name && editSourceNameInput) editSourceNameInput.focus();
      else if (!url && editSourceUrlInput) editSourceUrlInput.focus();
      return;
    }

    btnSubmitEditSource.disabled = true;
    btnSubmitEditSource.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 0.8s linear infinite;">
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
      </svg>
      Salvestan...
    `;

    try {
      const res = await fetch(`/api/sources/${sourceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url, category_id: categoryId })
      });
      const data = await res.json();
      if (!res.ok) {
        setModalError('editSourceErrorBanner', data.error || 'Allika muutmine ebaõnnestus');
        if (data.error && data.error.toLowerCase().includes('aadress')) {
          setFieldError(editSourceUrlInput, 'editSourceUrlError', data.error);
        } else {
          setFieldError(editSourceNameInput, 'editSourceNameError', data.error);
        }
      } else {
        showToast(`Allikas "${data.source.name}" edukalt uuendatud!`);
        closeEditModal();
        await loadSources();
        await loadArticles();
      }
    } catch (err) {
      console.error('Viga allika muutmisel:', err);
      setModalError('editSourceErrorBanner', 'Serveri viga allika muutmisel');
    } finally {
      btnSubmitEditSource.disabled = false;
      btnSubmitEditSource.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        Salvesta muudatused
      `;
    }
  });

  // ==========================================================================
  // Kategooria lisamise, muutmise ja kustutamise modaalid
  // ==========================================================================
  function clearAddCategoryErrors() {
    setFieldError(categoryNameInput, 'categoryNameError', '');
    setModalError('addCategoryErrorBanner', '');
  }

  function openAddCategoryModal() {
    if (addCategoryModal) {
      clearAddCategoryErrors();
      addCategoryModal.classList.add('open');
      if (categoryNameInput) {
        categoryNameInput.value = '';
        categoryNameInput.focus();
      }
    }
  }

  function closeAddCategoryModal() {
    if (addCategoryModal) {
      addCategoryModal.classList.remove('open');
      clearAddCategoryErrors();
      if (addCategoryForm) addCategoryForm.reset();
    }
  }

  if (categoryNameInput) {
    categoryNameInput.addEventListener('input', () => {
      setFieldError(categoryNameInput, 'categoryNameError', '');
      setModalError('addCategoryErrorBanner', '');
    });
  }

  if (addCategoryForm) {
    addCategoryForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAddCategoryErrors();

      const name = categoryNameInput ? categoryNameInput.value.trim() : '';
      if (!name) {
        setFieldError(categoryNameInput, 'categoryNameError', 'Palun sisesta kategooria nimi');
        if (categoryNameInput) categoryNameInput.focus();
        return;
      }

      btnSubmitCategory.disabled = true;
      btnSubmitCategory.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 0.8s linear infinite;">
          <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
        </svg>
        Salvestan...
      `;

      try {
        const res = await fetch('/api/categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        });
        const data = await res.json();
        if (!res.ok) {
          setFieldError(categoryNameInput, 'categoryNameError', data.error || 'Kategooria lisamine ebaõnnestus');
          setModalError('addCategoryErrorBanner', data.error || 'Kategooria lisamine ebaõnnestus');
          if (categoryNameInput) categoryNameInput.focus();
        } else {
          showToast(`Kategooria "${data.category.name}" edukalt lisatud!`);
          closeAddCategoryModal();
          await loadCategories();
          renderSources();
        }
      } catch (err) {
        console.error('Viga kategooria lisamisel:', err);
        setModalError('addCategoryErrorBanner', 'Serveri viga kategooria lisamisel');
      } finally {
        btnSubmitCategory.disabled = false;
        btnSubmitCategory.innerHTML = `
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          Lisa kategooria
        `;
      }
    });
  }

  function clearEditCategoryErrors() {
    setFieldError(editCategoryNameInput, 'editCategoryNameError', '');
    setModalError('editCategoryErrorBanner', '');
  }

  function openEditCategoryModal(category) {
    if (!category || !editCategoryModal) return;
    clearEditCategoryErrors();
    if (editCategoryIdInput) editCategoryIdInput.value = category.id;
    if (editCategoryNameInput) {
      editCategoryNameInput.value = category.name;
      editCategoryModal.classList.add('open');
      editCategoryNameInput.focus();
    }
  }

  function closeEditCategoryModal() {
    if (editCategoryModal) {
      editCategoryModal.classList.remove('open');
      clearEditCategoryErrors();
      if (editCategoryForm) editCategoryForm.reset();
    }
  }

  if (editCategoryNameInput) {
    editCategoryNameInput.addEventListener('input', () => {
      setFieldError(editCategoryNameInput, 'editCategoryNameError', '');
      setModalError('editCategoryErrorBanner', '');
    });
  }

  if (editCategoryForm) {
    editCategoryForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearEditCategoryErrors();

      const id = editCategoryIdInput ? editCategoryIdInput.value : '';
      const name = editCategoryNameInput ? editCategoryNameInput.value.trim() : '';
      if (!name) {
        setFieldError(editCategoryNameInput, 'editCategoryNameError', 'Palun sisesta kategooria nimi');
        if (editCategoryNameInput) editCategoryNameInput.focus();
        return;
      }

      btnSubmitEditCategory.disabled = true;
      btnSubmitEditCategory.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 0.8s linear infinite;">
          <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
        </svg>
        Salvestan...
      `;

      try {
        const res = await fetch(`/api/categories/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        });
        const data = await res.json();
        if (!res.ok) {
          setFieldError(editCategoryNameInput, 'editCategoryNameError', data.error || 'Kategooria uuendamine ebaõnnestus');
          setModalError('editCategoryErrorBanner', data.error || 'Kategooria uuendamine ebaõnnestus');
          if (editCategoryNameInput) editCategoryNameInput.focus();
        } else {
          showToast(`Kategooria "${data.category.name}" edukalt uuendatud!`);
          closeEditCategoryModal();
          await loadCategories();
          await loadSources();
          if (currentCategoryId === parseInt(id, 10)) {
            updateHeaderTitle();
          }
        }
      } catch (err) {
        console.error('Viga kategooria uuendamisel:', err);
        setModalError('editCategoryErrorBanner', 'Serveri viga kategooria uuendamisel');
      } finally {
        btnSubmitEditCategory.disabled = false;
        btnSubmitEditCategory.innerHTML = `
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          Salvesta muudatused
        `;
      }
    });
  }

  function openDeleteCategoryModal(category) {
    if (!category || !deleteCategoryModal) return;
    pendingDeleteCategory = category;
    if (deleteCategoryTargetName) {
      deleteCategoryTargetName.textContent = `"${category.name}"`;
    }
    deleteCategoryModal.classList.add('open');
    if (btnCancelDeleteCategory) btnCancelDeleteCategory.focus();
  }

  function closeDeleteCategoryModal() {
    if (deleteCategoryModal) {
      deleteCategoryModal.classList.remove('open');
    }
    pendingDeleteCategory = null;
  }

  async function handleConfirmDeleteCategory() {
    if (!pendingDeleteCategory) return;
    const categoryId = pendingDeleteCategory.id;
    const categoryName = pendingDeleteCategory.name;

    btnConfirmDeleteCategory.disabled = true;
    btnConfirmDeleteCategory.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 0.8s linear infinite;">
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
      </svg>
      Kustutan...
    `;

    try {
      const res = await fetch(`/api/categories/${categoryId}`, { method: 'DELETE' });
      if (res.ok) {
        showToast(`Kategooria "${categoryName}" kustutatud`);
        closeDeleteCategoryModal();
        if (currentCategoryId === categoryId) {
          currentCategoryId = null;
          resetFeedScrollPosition();
        }
        await loadCategories();
        await loadSources();
        await loadArticles({ scrollToTop: true });
      } else {
        showToast('Kategooria kustutamine ebaõnnestus', 'error');
      }
    } catch (err) {
      console.error('Viga kategooria kustutamisel:', err);
      showToast('Viga ühendusel serveriga', 'error');
    } finally {
      btnConfirmDeleteCategory.disabled = false;
      btnConfirmDeleteCategory.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
        Kustuta kategooria
      `;
    }
  }

  // ==========================================================================
  // Külgriba peitmine ja kuvamine (Desktop sujuv kokkuklappimine + Mobiil)
  // ==========================================================================
  function handleToggleSidebar() {
    const isMobile = window.innerWidth <= 900;
    if (isMobile) {
      const isOpen = sidebar.classList.toggle('mobile-open');
      if (btnToggleSidebar) {
        btnToggleSidebar.classList.toggle('active', isOpen);
      }
      if (sidebarOverlay) {
        sidebarOverlay.classList.toggle('active', isOpen);
      }
      updateModalScrollLock();
    } else {
      const isCollapsed = sidebar.classList.toggle('collapsed');
      if (btnToggleSidebar) {
        btnToggleSidebar.classList.toggle('active', isCollapsed);
        btnToggleSidebar.title = isCollapsed ? 'Näita menüüd' : 'Peida menüü';
      }
      localStorage.setItem('lugeja_sidebar_collapsed', isCollapsed ? '1' : '0');

      // Kui menüü läheb peitu, lülita uudisvoog automaatselt kõikide allikate valikule
      if (isCollapsed && (currentSourceId !== null || currentCategoryId !== null)) {
        currentSourceId = null;
        currentCategoryId = null;
        resetFeedScrollPosition();
        updateActiveNav();
        loadArticles({ scrollToTop: true });
      }
    }
  }

  function closeMobileSidebar() {
    sidebar.classList.remove('mobile-open');
    if (btnToggleSidebar && window.innerWidth <= 900) {
      btnToggleSidebar.classList.remove('active');
    }
    if (sidebarOverlay) {
      sidebarOverlay.classList.remove('active');
    }
    updateModalScrollLock();
  }

  // Taasta salvestatud eelistus töölaual
  if (window.innerWidth > 900 && localStorage.getItem('lugeja_sidebar_collapsed') === '1') {
    sidebar.classList.add('collapsed');
    if (btnToggleSidebar) {
      btnToggleSidebar.classList.add('active');
      btnToggleSidebar.title = 'Näita menüüd';
    }
  }

  // ==========================================================================
  // Sündmuste sidumine (Event Listeners)
  // ==========================================================================

  // "Kõik" nupp külgriba allosas või alguses
  document.getElementById('navItemAll').addEventListener('click', () => {
    if (currentSourceId === null && currentCategoryId === null && !isReadLaterView) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      closeMobileSidebar();
      return;
    }
    currentSourceId = null;
    currentCategoryId = null;
    isReadLaterView = false;
    resetFeedScrollPosition();
    updateActiveNav();
    loadSources();
    loadArticles({ scrollToTop: true });
    closeMobileSidebar();
  });

  // "Loe hiljem" nupp
  if (navItemReadLater) {
    navItemReadLater.addEventListener('click', () => {
      if (isReadLaterView) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        closeMobileSidebar();
        return;
      }
      currentSourceId = null;
      currentCategoryId = null;
      isReadLaterView = true;
      resetFeedScrollPosition();
      updateActiveNav();
      loadArticles({ scrollToTop: true });
      closeMobileSidebar();
    });
  }

  btnRefresh.addEventListener('click', handleRefresh);
  btnMarkAllRead.addEventListener('click', handleMarkAllRead);

  // Toggle "Näita loetud artikleid"
  btnToggleRead.addEventListener('click', () => {
    showReadArticles = !showReadArticles;
    btnToggleRead.classList.toggle('active', showReadArticles);
    btnToggleRead.title = showReadArticles ? 'Peida juba loetud uudised' : 'Kuva ka loetud uudised';
    resetFeedScrollPosition();
    loadArticles({ scrollToTop: true });
  });

  // "Lisa" rippmenüü (Allikas või Kategooria)
  if (btnOpenAddDropdown) {
    btnOpenAddDropdown.addEventListener('click', (e) => {
      e.stopPropagation();
      addDropdownWrap.classList.toggle('open');
      const isOpen = addDropdownWrap.classList.contains('open');
      btnOpenAddDropdown.setAttribute('aria-expanded', isOpen);
    });
  }

  document.addEventListener('click', (e) => {
    if (addDropdownWrap && !addDropdownWrap.contains(e.target)) {
      addDropdownWrap.classList.remove('open');
      if (btnOpenAddDropdown) btnOpenAddDropdown.setAttribute('aria-expanded', 'false');
    }
  });

  if (btnAddSourceChoice) {
    btnAddSourceChoice.addEventListener('click', () => {
      if (addDropdownWrap) addDropdownWrap.classList.remove('open');
      if (btnOpenAddDropdown) btnOpenAddDropdown.setAttribute('aria-expanded', 'false');
      openAddModal();
    });
  }

  if (btnAddCategoryChoice) {
    btnAddCategoryChoice.addEventListener('click', () => {
      if (addDropdownWrap) addDropdownWrap.classList.remove('open');
      if (btnOpenAddDropdown) btnOpenAddDropdown.setAttribute('aria-expanded', 'false');
      openAddCategoryModal();
    });
  }

  // Allika modaalide nupud
  btnCloseAddSource.addEventListener('click', closeAddModal);
  btnCancelAddSource.addEventListener('click', closeAddModal);
  addSourceModal.addEventListener('click', (e) => {
    if (e.target === addSourceModal) closeAddModal();
  });

  // Allika kustutamise kinnitusmodaali nupud
  if (btnCloseDeleteModal) btnCloseDeleteModal.addEventListener('click', closeDeleteModal);
  if (btnCancelDeleteSource) btnCancelDeleteSource.addEventListener('click', closeDeleteModal);
  if (btnConfirmDeleteSource) btnConfirmDeleteSource.addEventListener('click', handleConfirmDeleteSource);
  if (deleteSourceModal) {
    deleteSourceModal.addEventListener('click', (e) => {
      if (e.target === deleteSourceModal) closeDeleteModal();
    });
  }

  // Allika muutmise modaali nupud
  if (btnCloseEditSource) btnCloseEditSource.addEventListener('click', closeEditModal);
  if (btnCancelEditSource) btnCancelEditSource.addEventListener('click', closeEditModal);
  if (editSourceModal) {
    editSourceModal.addEventListener('click', (e) => {
      if (e.target === editSourceModal) closeEditModal();
    });
  }

  // Kategooria lisamise modaali nupud
  if (btnCloseAddCategory) btnCloseAddCategory.addEventListener('click', closeAddCategoryModal);
  if (btnCancelAddCategory) btnCancelAddCategory.addEventListener('click', closeAddCategoryModal);
  if (addCategoryModal) {
    addCategoryModal.addEventListener('click', (e) => {
      if (e.target === addCategoryModal) closeAddCategoryModal();
    });
  }

  // Kategooria muutmise modaali nupud
  if (btnCloseEditCategory) btnCloseEditCategory.addEventListener('click', closeEditCategoryModal);
  if (btnCancelEditCategory) btnCancelEditCategory.addEventListener('click', closeEditCategoryModal);
  if (editCategoryModal) {
    editCategoryModal.addEventListener('click', (e) => {
      if (e.target === editCategoryModal) closeEditCategoryModal();
    });
  }

  // Kategooria kustutamise modaali nupud
  if (btnCloseDeleteCategoryModal) btnCloseDeleteCategoryModal.addEventListener('click', closeDeleteCategoryModal);
  if (btnCancelDeleteCategory) btnCancelDeleteCategory.addEventListener('click', closeDeleteCategoryModal);
  if (btnConfirmDeleteCategory) btnConfirmDeleteCategory.addEventListener('click', handleConfirmDeleteCategory);
  if (deleteCategoryModal) {
    deleteCategoryModal.addEventListener('click', (e) => {
      if (e.target === deleteCategoryModal) closeDeleteCategoryModal();
    });
  }

  // Külgriba lüliti
  if (btnToggleSidebar) btnToggleSidebar.addEventListener('click', handleToggleSidebar);
  if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeMobileSidebar);

  // Mobiilivaates menüü sulgemine ekraanile (väljapoole menüüd) vajutades
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 900 && sidebar.classList.contains('mobile-open')) {
      if (!sidebar.contains(e.target) && !btnToggleSidebar.contains(e.target)) {
        closeMobileSidebar();
      }
    }
  });

  // Ekraani laiuse muutumisel korrasta mobiilimenüü ja kerimislukk
  window.addEventListener('resize', () => {
    if (window.innerWidth > 900 && sidebar && sidebar.classList.contains('mobile-open')) {
      closeMobileSidebar();
    } else {
      updateModalScrollLock();
    }
  });

  // OPML eksport
  const btnExportOpml = document.getElementById('btnExportOpml') || document.getElementById('btnProfileExportOpml');
  if (btnExportOpml) {
    btnExportOpml.addEventListener('click', (e) => {
      if (sourcesData.length === 0) {
        e.preventDefault();
        showToast('Ühtegi allikat pole eksportimiseks!');
        return;
      }
      showToast('Tellimuste eksport (OPML) alla laaditud');
    });
  }

  // OPML import
  async function handleOpmlFileImport(file) {
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith('.opml') && !lowerName.endsWith('.xml')) {
      showToast('Hoiatus: faililaiend peaks olema .opml või .xml', 'info');
    }

    const originalText = btnProfileImportOpmlText ? btnProfileImportOpmlText.textContent : 'Impordi';
    if (btnProfileImportOpmlText) {
      btnProfileImportOpmlText.textContent = 'Impordin...';
    }
    if (btnProfileImportOpml) btnProfileImportOpml.disabled = true;
    if (btnAddSourceImportOpml) btnAddSourceImportOpml.disabled = true;

    showToast('Impordin OPML faili...');

    const formData = new FormData();
    formData.append('file', file);

    let data;
    try {
      const resp = await fetch('/api/import/opml', {
        method: 'POST',
        body: formData
      });

      if (resp.status === 401) {
        showAuthOverlay('login');
        return;
      }

      data = await resp.json();

      if (!resp.ok || !data.success) {
        showToast(data.error || 'OPML importimine ebaõnnestus!', 'error');
        return;
      }
    } catch (err) {
      console.error('Viga OPML impordi võrgupäringul:', err);
      showToast('Ühenduse viga OPML faili importimisel!', 'error');
      return;
    } finally {
      if (btnProfileImportOpmlText) {
        btnProfileImportOpmlText.textContent = originalText;
      }
      if (btnProfileImportOpml) btnProfileImportOpml.disabled = false;
      if (btnAddSourceImportOpml) btnAddSourceImportOpml.disabled = false;
      if (opmlFileInput) opmlFileInput.value = '';
    }

    // Edukas import: sulge aknad ja laadi uued andmed
    try {
      showToast(data.message || 'Tellimused edukalt imporditud!');
      closeUserProfileModal();
      if (typeof closeAddModal === 'function') {
        closeAddModal();
      } else if (addSourceModal) {
        addSourceModal.classList.remove('open');
      }

      // Värskendame kategooriad, allikad ja artiklid paralleelselt
      await Promise.all([
        loadCategories(),
        loadSources(),
        loadArticles()
      ]);
      renderSources();
    } catch (uiErr) {
      console.error('Hoiatus andmete värskendamisel pärast importi:', uiErr);
    }
  }

  if (btnProfileImportOpml && opmlFileInput) {
    btnProfileImportOpml.addEventListener('click', () => {
      opmlFileInput.click();
    });
  }

  if (btnAddSourceImportOpml && opmlFileInput) {
    btnAddSourceImportOpml.addEventListener('click', () => {
      opmlFileInput.click();
    });
  }

  if (opmlFileInput) {
    opmlFileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        handleOpmlFileImport(file);
      }
    });
  }

  // Kasutajakonto profiil ja väljalogimine
  if (btnUserMenu) btnUserMenu.addEventListener('click', openUserProfileModal);
  if (btnCloseUserProfileModal) btnCloseUserProfileModal.addEventListener('click', closeUserProfileModal);
  if (userProfileModal) {
    userProfileModal.addEventListener('click', (e) => {
      if (e.target === userProfileModal) closeUserProfileModal();
    });
  }

  if (window.ResizeObserver && statMostActiveSourceRow && statFavoriteSourceRow) {
    const statRo = new ResizeObserver(() => {
      updateAllStatMarquees();
    });
    statRo.observe(statMostActiveSourceRow);
    statRo.observe(statFavoriteSourceRow);
  } else {
    window.addEventListener('resize', () => {
      updateAllStatMarquees();
    });
  }

  if (btnLogout) btnLogout.addEventListener('click', handleLogout);
  if (btnOpenDeleteAccountModal) {
    btnOpenDeleteAccountModal.addEventListener('click', () => {
      if (currentUser && currentUser.is_admin) {
        return;
      }
      closeUserProfileModal();
      openDeleteAccountModal();
    });
  }

  // Kasutajakonto kustutamise kinnitusmodaal
  if (btnCloseDeleteAccountModal) btnCloseDeleteAccountModal.addEventListener('click', closeDeleteAccountModal);
  if (btnCancelDeleteAccount) btnCancelDeleteAccount.addEventListener('click', closeDeleteAccountModal);
  if (btnConfirmDeleteAccount) btnConfirmDeleteAccount.addEventListener('click', handleConfirmDeleteAccount);
  if (deleteAccountModal) {
    deleteAccountModal.addEventListener('click', (e) => {
      if (e.target === deleteAccountModal) closeDeleteAccountModal();
    });
  }

  // Autentimise kihi nupud ja vormid
  if (tabLogin) tabLogin.addEventListener('click', () => switchAuthTab('login'));
  if (tabRegister) tabRegister.addEventListener('click', () => switchAuthTab('register'));
  if (btnForgotPassword) btnForgotPassword.addEventListener('click', () => switchAuthTab('forgot'));
  if (btnBackToLoginFromForgot) btnBackToLoginFromForgot.addEventListener('click', () => switchAuthTab('login'));
  if (btnBackToLoginFromReset) btnBackToLoginFromReset.addEventListener('click', () => switchAuthTab('login'));
  if (loginForm) loginForm.addEventListener('submit', handleLogin);
  if (registerForm) registerForm.addEventListener('submit', handleRegister);
  if (forgotPasswordForm) forgotPasswordForm.addEventListener('submit', handleForgot);
  if (resetPasswordForm) resetPasswordForm.addEventListener('submit', handleReset);

  // Kasutajaprofiili e-posti muutmine
  if (btnOpenEditEmail) {
    btnOpenEditEmail.addEventListener('click', () => {
      if (profileEmailEditForm) {
        const isShown = profileEmailEditForm.style.display !== 'none';
        profileEmailEditForm.style.display = isShown ? 'none' : 'flex';
        if (!isShown && profileEmailInput) {
          profileEmailInput.focus();
        }
      }
    });
  }
  if (btnCancelProfileEmail) {
    btnCancelProfileEmail.addEventListener('click', () => {
      if (profileEmailEditForm) profileEmailEditForm.style.display = 'none';
      if (profileEmailInput && currentUser) profileEmailInput.value = currentUser.email || '';
    });
  }
  if (profileEmailEditForm) {
    profileEmailEditForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!profileEmailInput) return;
      const newEmail = profileEmailInput.value.trim();
      const btnSave = document.getElementById('btnSaveProfileEmail');
      if (btnSave) btnSave.disabled = true;
      try {
        const res = await fetch('/api/user/email', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: newEmail })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          showToast(data.error || 'E-posti salvestamine ebaõnnestus!', 'error');
          return;
        }
        if (currentUser) {
          currentUser.email = data.email;
        }
        if (userProfileEmailVal) {
          userProfileEmailVal.textContent = data.email || 'Määramata';
          userProfileEmailVal.style.color = data.email ? 'var(--va-t1)' : 'var(--va-t3)';
        }
        profileEmailEditForm.style.display = 'none';
        showToast('E-posti aadress edukalt salvestatud!');
      } catch (err) {
        console.error('E-posti salvestamise viga:', err);
        showToast('Ühenduse viga e-posti salvestamisel.', 'error');
      } finally {
        if (btnSave) btnSave.disabled = false;
      }
    });
  }

  // Klaviatuuri kiirklahvid
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (window.innerWidth <= 900 && sidebar.classList.contains('mobile-open')) {
        closeMobileSidebar();
      }
      if (addDropdownWrap && addDropdownWrap.classList.contains('open')) {
        addDropdownWrap.classList.remove('open');
        if (btnOpenAddDropdown) btnOpenAddDropdown.setAttribute('aria-expanded', 'false');
      }
      if (userProfileModal && userProfileModal.classList.contains('open')) {
        closeUserProfileModal();
      }
      if (deleteAccountModal && deleteAccountModal.classList.contains('open')) {
        closeDeleteAccountModal();
      }
      if (addSourceModal && addSourceModal.classList.contains('open')) {
        closeAddModal();
      }
      if (deleteSourceModal && deleteSourceModal.classList.contains('open')) {
        closeDeleteModal();
      }
      if (editSourceModal && editSourceModal.classList.contains('open')) {
        closeEditModal();
      }
      if (addCategoryModal && addCategoryModal.classList.contains('open')) {
        closeAddCategoryModal();
      }
      if (editCategoryModal && editCategoryModal.classList.contains('open')) {
        closeEditCategoryModal();
      }
      if (deleteCategoryModal && deleteCategoryModal.classList.contains('open')) {
        closeDeleteCategoryModal();
      }
      if ((forgotPasswordForm && forgotPasswordForm.style.display !== 'none') || (resetPasswordForm && resetPasswordForm.style.display !== 'none')) {
        switchAuthTab('login');
      }
    }
    // 'r' vajutus ilma fookuseta sisendväljal värskendab käsitsi allikaid.
    // TÄHTIS: Välistame modifikaatorid (Ctrl, Cmd, Alt), et brauseri tavapärane lehe
    // värskendamine (Ctrl+R / Cmd+R) ei käivitaks tahtmatult allikate taustauuendust!
    if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      handleRefresh();
    }
  });

  // ==========================================================================
  // Kasutajahaldus ja Autentimise funktsioonid
  // ==========================================================================
  function handleAuthRequired() {
    currentUser = null;
    showAuthOverlay('login');
  }

  let systemHasUsers = true;

  function updateAdminHintVisibility() {
    if (authAdminHint) {
      authAdminHint.style.display = systemHasUsers ? 'none' : 'flex';
    }
  }

  async function checkAuth() {
    if (activeResetToken) {
      showAuthOverlay('reset');
      return false;
    }
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      if (data) {
        if (data.has_users !== undefined) {
          systemHasUsers = Boolean(data.has_users);
          updateAdminHintVisibility();
        }
        if (data.authenticated && data.user) {
          currentUser = data.user;
          updateUserUI();
          hideAuthOverlay();
          return true;
        }
      }
    } catch (e) {
      console.warn('Viga autentimise kontrollimisel:', e);
      // PWA offline tugi: kui võrguühendust pole ning brauseris on eelnevalt sisselogitud kasutaja andmed,
      // lubame rakenduse vahemälust avada ilma sisselogimisaknaga blokeerimata.
      if (!navigator.onLine && localStorage.getItem('lugeja_user_initial')) {
        currentUser = {
          id: 0,
          username: localStorage.getItem('lugeja_username') || 'Kasutaja',
          is_admin: false
        };
        updateUserUI();
        hideAuthOverlay();
        return true;
      }
    }
    currentUser = null;
    const urlTab = new URLSearchParams(window.location.search).get('tab');
    showAuthOverlay(urlTab || (systemHasUsers ? 'login' : 'register'));
    return false;
  }

  function updateUserUI() {
    if (!currentUser) {
      localStorage.removeItem('lugeja_user_initial');
      localStorage.removeItem('lugeja_username');
      if (userAvatarInitial) userAvatarInitial.innerHTML = USER_ICON_SVG;
      if (userProfileAvatarInitial) userProfileAvatarInitial.innerHTML = USER_LARGE_ICON_SVG;
      return;
    }
    const initial = (currentUser.username || '').charAt(0).toUpperCase();
    if (initial) {
      localStorage.setItem('lugeja_user_initial', initial);
      if (userAvatarInitial) userAvatarInitial.textContent = initial;
      if (userProfileAvatarInitial) userProfileAvatarInitial.textContent = initial;
    } else {
      if (userAvatarInitial) userAvatarInitial.innerHTML = USER_ICON_SVG;
      if (userProfileAvatarInitial) userProfileAvatarInitial.innerHTML = USER_LARGE_ICON_SVG;
    }
    if (currentUser.username) {
      localStorage.setItem('lugeja_username', currentUser.username);
    }
    if (userProfileUsername) userProfileUsername.textContent = currentUser.username;
    pingDeviceUsage();

    if (userProfileRoleBadge) {
      if (currentUser.is_admin) {
        userProfileRoleBadge.textContent = 'Admin';
        userProfileRoleBadge.className = 'badge-role badge-role-admin';
      } else {
        userProfileRoleBadge.textContent = 'Kasutaja';
        userProfileRoleBadge.className = 'badge-role badge-role-user';
      }
    }

    if (userProfileEmailVal) {
      userProfileEmailVal.textContent = currentUser.email || 'Määramata';
      userProfileEmailVal.style.color = currentUser.email ? 'var(--va-t1)' : 'var(--va-t3)';
    }
    if (profileEmailInput) {
      profileEmailInput.value = currentUser.email || '';
    }
    if (profileEmailEditForm) {
      profileEmailEditForm.style.display = 'none';
    }

    if (adminProtectedNotice) {
      adminProtectedNotice.style.display = 'none';
    }

    if (btnOpenDeleteAccountModal) {
      if (currentUser && currentUser.is_admin) {
        btnOpenDeleteAccountModal.style.display = 'none';
      } else {
        btnOpenDeleteAccountModal.style.display = '';
        btnOpenDeleteAccountModal.className = 'btn btn-danger btn-user-action';
        btnOpenDeleteAccountModal.title = 'Kustuta oma kasutajakonto';
        btnOpenDeleteAccountModal.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
          <span id="btnDeleteAccountText">Kustuta</span>
        `;
      }
    }

    if (userProfileCreated && currentUser.created_at) {
      try {
        const d = new Date(currentUser.created_at);
        userProfileCreated.textContent = `Liitunud: ${d.toLocaleDateString('et-EE')}`;
      } catch (e) {
        userProfileCreated.textContent = '';
      }
    }
  }

  function showAuthOverlay(tab = 'login') {
    document.body.classList.add('not-authenticated');
    if (authOverlay) {
      authOverlay.style.display = 'flex';
      switchAuthTab(tab);
    }
  }

  function hideAuthOverlay() {
    document.body.classList.remove('not-authenticated');
    if (authOverlay) {
      authOverlay.style.display = 'none';
      setAuthError('');
      setAuthSuccess('');
    }
  }

  function setFieldError(inputEl, errorElId, message) {
    if (!inputEl) return;
    const errorEl = document.getElementById(errorElId);
    if (message) {
      inputEl.classList.add('is-invalid');
      if (errorEl) {
        errorEl.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <span>${escapeHtml(message)}</span>
        `;
        errorEl.style.display = 'flex';
      }
    } else {
      inputEl.classList.remove('is-invalid');
      if (errorEl) {
        errorEl.innerHTML = '';
        errorEl.style.display = 'none';
      }
    }
  }

  function clearAllAuthErrors() {
    setAuthError('');
    setAuthSuccess('');
    setFieldError(loginUsernameInput, 'loginUsernameError', '');
    setFieldError(loginPasswordInput, 'loginPasswordError', '');
    setFieldError(regUsernameInput, 'regUsernameError', '');
    setFieldError(regEmailInput, 'regEmailError', '');
    setFieldError(regPasswordInput, 'regPasswordError', '');
    setFieldError(regPasswordConfirmInput, 'regPasswordConfirmError', '');
    setFieldError(forgotIdentifierInput, 'forgotIdentifierError', '');
    setFieldError(resetNewPasswordInput, 'resetNewPasswordError', '');
    setFieldError(resetNewPasswordConfirmInput, 'resetNewPasswordConfirmError', '');
  }

  function switchAuthTab(tab) {
    clearAllAuthErrors();
    updateAdminHintVisibility();

    // Peidame kõik vormid esmalt
    if (loginForm) loginForm.style.display = 'none';
    if (registerForm) registerForm.style.display = 'none';
    if (forgotPasswordForm) forgotPasswordForm.style.display = 'none';
    if (resetPasswordForm) resetPasswordForm.style.display = 'none';

    if (tab === 'login') {
      if (authTabs) authTabs.style.display = 'flex';
      if (tabLogin) tabLogin.classList.add('active');
      if (tabRegister) tabRegister.classList.remove('active');
      if (loginForm) loginForm.style.display = 'flex';
      if (loginUsernameInput) loginUsernameInput.focus();
    } else if (tab === 'register') {
      if (authTabs) authTabs.style.display = 'flex';
      if (tabRegister) tabRegister.classList.add('active');
      if (tabLogin) tabLogin.classList.remove('active');
      if (registerForm) registerForm.style.display = 'flex';
      if (regUsernameInput) regUsernameInput.focus();
    } else if (tab === 'forgot') {
      if (authTabs) authTabs.style.display = 'none';
      if (forgotPasswordForm) forgotPasswordForm.style.display = 'flex';
      if (forgotIdentifierInput) {
        forgotIdentifierInput.value = (loginUsernameInput ? loginUsernameInput.value.trim() : '');
        forgotIdentifierInput.focus();
      }
    } else if (tab === 'reset') {
      if (authTabs) authTabs.style.display = 'none';
      if (resetPasswordForm) resetPasswordForm.style.display = 'flex';
      if (resetNewPasswordInput) resetNewPasswordInput.focus();
    }
  }

  function setAuthError(msg) {
    if (!authErrorBanner) return;
    if (msg) {
      authErrorBanner.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="flex-shrink:0;">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <span>${escapeHtml(msg)}</span>
      `;
      authErrorBanner.style.display = 'flex';
      if (authSuccessBanner) authSuccessBanner.style.display = 'none';
    } else {
      authErrorBanner.innerHTML = '';
      authErrorBanner.style.display = 'none';
    }
  }

  function setAuthSuccess(msg) {
    if (!authSuccessBanner) return;
    if (msg) {
      authSuccessBanner.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="flex-shrink:0;">
          <path d="M20 6L9 17l-5-5"/>
        </svg>
        <span>${escapeHtml(msg)}</span>
      `;
      authSuccessBanner.style.display = 'flex';
      if (authErrorBanner) authErrorBanner.style.display = 'none';
    } else {
      authSuccessBanner.innerHTML = '';
      authSuccessBanner.style.display = 'none';
    }
  }

  // Sisestuse ajal vigade automaatne eemaldamine
  [
    { input: loginUsernameInput, err: 'loginUsernameError' },
    { input: loginPasswordInput, err: 'loginPasswordError' },
    { input: regUsernameInput, err: 'regUsernameError' },
    { input: regEmailInput, err: 'regEmailError' },
    { input: regPasswordInput, err: 'regPasswordError' },
    { input: regPasswordConfirmInput, err: 'regPasswordConfirmError' },
    { input: forgotIdentifierInput, err: 'forgotIdentifierError' },
    { input: resetNewPasswordInput, err: 'resetNewPasswordError' },
    { input: resetNewPasswordConfirmInput, err: 'resetNewPasswordConfirmError' }
  ].forEach(({ input, err }) => {
    if (input) {
      input.addEventListener('input', () => {
        setFieldError(input, err, '');
        setAuthError('');
        setAuthSuccess('');
      });
    }
  });

  async function clearOfflineDataCache() {
    if ('caches' in window) {
      try {
        const keys = await caches.keys();
        for (const k of keys) {
          if (k.includes('data')) {
            await caches.delete(k);
          }
        }
      } catch (e) {
        console.warn('Viga andmete vahemälu puhastamisel:', e);
      }
    }
  }

  function updateStatSourceMarquee(rowEl, nameEl) {
    if (!rowEl || !nameEl) return;
    const text = nameEl.textContent ? nameEl.textContent.trim() : '';
    if (!text || text === '-' || text === '') {
      rowEl.classList.remove('is-scrolling');
      rowEl.style.removeProperty('--marquee-distance');
      rowEl.style.removeProperty('--marquee-duration');
      return;
    }

    rowEl.classList.remove('is-scrolling');
    nameEl.style.display = 'inline-block';
    nameEl.style.width = 'max-content';
    nameEl.style.maxWidth = 'none';

    const fullWidth = nameEl.scrollWidth;
    const containerWidth = rowEl.clientWidth;

    nameEl.style.display = '';
    nameEl.style.width = '';
    nameEl.style.maxWidth = '';

    const overflow = fullWidth - containerWidth;
    if (overflow > 4) {
      rowEl.classList.add('is-scrolling');
      rowEl.style.setProperty('--marquee-distance', `-${overflow}px`);
      const duration = Math.max(5, (overflow / 22) + 3);
      rowEl.style.setProperty('--marquee-duration', `${duration.toFixed(1)}s`);
    } else {
      rowEl.classList.remove('is-scrolling');
      rowEl.style.removeProperty('--marquee-distance');
      rowEl.style.removeProperty('--marquee-duration');
    }
  }

  function updateAllStatMarquees() {
    updateStatSourceMarquee(statMostActiveSourceRow, statMostActiveSourceName);
    updateStatSourceMarquee(statFavoriteSourceRow, statFavoriteSourceName);
  }

  async function loadUserStats() {
    if (!currentUser) return;
    try {
      const res = await fetch('/api/user/stats');
      if (!res.ok) return;
      const stats = await res.json();
      if (!stats) return;

      // 1. Konto vanus
      if (statAccountAge) {
        statAccountAge.textContent = stats.account_age_text || '-';
      }

      // 2. Loetud uudised (avatud lood) ja lugemise määr (%)
      if (statOpenedCount) {
        statOpenedCount.textContent = Number(stats.opened_count || 0).toLocaleString('et-EE');
      }
      if (statOpenedRate) {
        statOpenedRate.textContent = `${stats.read_rate_percent || 0}%`;
      }

      // 3. Läbi sirvitud (voos loetuks märgitud / mööda keritud)
      if (statScrolledReadCount) {
        statScrolledReadCount.textContent = Number(stats.scrolled_read_count || 0).toLocaleString('et-EE');
      }

      // 4. Tellitud allikad
      if (statSourcesCount) {
        statSourcesCount.textContent = Number(stats.sources_count || 0).toLocaleString('et-EE');
      }

      // 5. Aktiivseim allikas (ei näita arvu sulgudes)
      if (statMostActiveSourceName) {
        statMostActiveSourceName.textContent = stats.most_active_source?.name || '-';
        statMostActiveSourceName.title = stats.most_active_source?.name || '';
      }

      // 6. Loetuim allikas (ei näita arvu sulgudes)
      if (statFavoriteSourceName) {
        statFavoriteSourceName.textContent = stats.favorite_source?.name || '-';
        statFavoriteSourceName.title = stats.favorite_source?.name || '';
      }

      requestAnimationFrame(() => {
        updateAllStatMarquees();
      });

      // 7. Seadmete kasutus (mobiil vs arvuti sujuv graafiline riba)
      if (stats.device_stats && userDeviceUsageCard) {
        const ds = stats.device_stats;
        const mobPct = typeof ds.mobile_percent === 'number' ? ds.mobile_percent : 50;
        const dskPct = typeof ds.desktop_percent === 'number' ? ds.desktop_percent : (100 - mobPct);

        if (deviceMobilePercent) deviceMobilePercent.textContent = `${mobPct}%`;
        if (deviceDesktopPercent) deviceDesktopPercent.textContent = `${dskPct}%`;

        userDeviceUsageCard.style.setProperty('--mob-pct', `${mobPct}%`);
        userDeviceUsageCard.classList.remove('dominant-mobile', 'dominant-desktop', 'dominant-equal');
        if (ds.dominant === 'mobile') {
          userDeviceUsageCard.classList.add('dominant-mobile');
        } else if (ds.dominant === 'desktop') {
          userDeviceUsageCard.classList.add('dominant-desktop');
        } else {
          userDeviceUsageCard.classList.add('dominant-equal');
        }

        // Tagame ülimalt sujuva ja loomuliku värvide ülemineku ribal
        if (deviceBarTrack) {
          if (ds.dominant === 'mobile') {
            const p1 = Math.max(0, mobPct - 20);
            const p2 = mobPct;
            const p3 = Math.min(100, mobPct + 18);
            const p4 = Math.min(100, mobPct + 35);
            deviceBarTrack.style.background = `linear-gradient(90deg, #358D4D 0%, rgba(53, 141, 77, 0.85) ${p1}%, rgba(53, 141, 77, 0.45) ${p2}%, rgba(53, 141, 77, 0.16) ${p3}%, rgba(255, 255, 255, 0.07) ${p4}%, rgba(255, 255, 255, 0.06) 100%)`;
          } else if (ds.dominant === 'desktop') {
            const p1 = Math.max(0, mobPct - 35);
            const p2 = Math.max(0, mobPct - 18);
            const p3 = mobPct;
            const p4 = Math.min(100, mobPct + 20);
            deviceBarTrack.style.background = `linear-gradient(90deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0.07) ${p1}%, rgba(53, 141, 77, 0.16) ${p2}%, rgba(53, 141, 77, 0.45) ${p3}%, rgba(53, 141, 77, 0.85) ${p4}%, #358D4D 100%)`;
          } else {
            deviceBarTrack.style.background = `linear-gradient(90deg, rgba(53, 141, 77, 0.7) 0%, #358D4D 50%, rgba(53, 141, 77, 0.7) 100%)`;
          }
        }
      }
    } catch (e) {
      console.warn('Viga kasutaja statistika laadimisel:', e);
    }
  }

  function openUserProfileModal() {
    if (userProfileModal) {
      updateUserUI();
      loadUserStats();
      userProfileModal.classList.add('open');
      requestAnimationFrame(() => {
        updateAllStatMarquees();
      });
    }
  }

  function closeUserProfileModal() {
    if (userProfileModal) {
      userProfileModal.classList.remove('open');
    }
  }

  function openDeleteAccountModal() {
    if (deleteAccountModal && currentUser) {
      if (deleteAccountUsername) {
        deleteAccountUsername.textContent = currentUser.username;
      }
      deleteAccountModal.classList.add('open');
    }
  }

  function closeDeleteAccountModal() {
    if (deleteAccountModal) {
      deleteAccountModal.classList.remove('open');
    }
  }

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      console.warn('Väljalogimise viga:', e);
    }
    closeUserProfileModal();
    await clearOfflineDataCache();
    currentUser = null;
    localStorage.removeItem('lugeja_user_initial');
    localStorage.removeItem('lugeja_username');
    if (userAvatarInitial) userAvatarInitial.innerHTML = USER_ICON_SVG;
    if (userProfileAvatarInitial) userProfileAvatarInitial.innerHTML = USER_LARGE_ICON_SVG;
    articlesData = [];
    sourcesData = [];
    categoriesData = [];
    currentSourceId = null;
    currentCategoryId = null;
    renderSources();
    renderFeed();
    showAuthOverlay('login');
    showToast('Oled edukalt välja logitud.');
  }

  async function handleConfirmDeleteAccount() {
    if (!currentUser) return;
    if (btnConfirmDeleteAccount) {
      btnConfirmDeleteAccount.disabled = true;
      btnConfirmDeleteAccount.textContent = 'Kustutan...';
    }
    try {
      const res = await fetch('/api/auth/delete-account', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.error || 'Konto kustutamine ebaõnnestus!', 'error');
        if (btnConfirmDeleteAccount) {
          btnConfirmDeleteAccount.disabled = false;
          btnConfirmDeleteAccount.textContent = 'Kustuta minu konto';
        }
        return;
      }
      closeDeleteAccountModal();
      closeUserProfileModal();
      await clearOfflineDataCache();
      currentUser = null;
      localStorage.removeItem('lugeja_user_initial');
      if (userAvatarInitial) userAvatarInitial.innerHTML = USER_ICON_SVG;
      if (userProfileAvatarInitial) userProfileAvatarInitial.innerHTML = USER_LARGE_ICON_SVG;
      articlesData = [];
      sourcesData = [];
      categoriesData = [];
      currentSourceId = null;
      currentCategoryId = null;
      renderSources();
      renderFeed();
      if (data && data.has_users !== undefined) {
        systemHasUsers = Boolean(data.has_users);
      }
      updateAdminHintVisibility();
      showAuthOverlay(systemHasUsers ? 'login' : 'register');
      showToast('Sinu konto ja kõik seotud andmed on edukalt kustutatud.');
    } catch (err) {
      console.error('Konto kustutamise viga:', err);
      showToast('Ühenduse viga konto kustutamisel.', 'error');
    } finally {
      if (btnConfirmDeleteAccount) {
        btnConfirmDeleteAccount.disabled = false;
        btnConfirmDeleteAccount.textContent = 'Kustuta minu konto';
      }
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    clearAllAuthErrors();

    const username = (loginUsernameInput ? loginUsernameInput.value : '').trim();
    const password = (loginPasswordInput ? loginPasswordInput.value : '').trim();

    let hasError = false;
    if (!username) {
      setFieldError(loginUsernameInput, 'loginUsernameError', 'Palun sisesta kasutajanimi');
      hasError = true;
    }
    if (!password) {
      setFieldError(loginPasswordInput, 'loginPasswordError', 'Palun sisesta salasõna');
      hasError = true;
    }

    if (hasError) {
      if (!username && loginUsernameInput) loginUsernameInput.focus();
      else if (!password && loginPasswordInput) loginPasswordInput.focus();
      return;
    }

    const btnSubmit = document.getElementById('btnSubmitLogin');
    if (btnSubmit) btnSubmit.disabled = true;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setAuthError(data.error || 'Vale kasutajanimi või salasõna!');
        if (loginUsernameInput) loginUsernameInput.classList.add('is-invalid');
        if (loginPasswordInput) loginPasswordInput.classList.add('is-invalid');
        if (btnSubmit) btnSubmit.disabled = false;
        return;
      }

      currentUser = data.user;
      updateUserUI();
      hideAuthOverlay();
      if (loginForm) loginForm.reset();
      clearAllAuthErrors();
      await clearOfflineDataCache();
      showToast(`Tere tulemast tagasi, ${currentUser.username}!`);
      // Laeme kasutaja andmed paralleelselt
      await Promise.all([
        loadCategories(),
        loadSources(),
        loadArticles()
      ]);
      renderSources();
    } catch (err) {
      console.error('Sisselogimise viga:', err);
      setAuthError('Ühenduse viga serveriga. Palun proovi uuesti!');
    } finally {
      if (btnSubmit) btnSubmit.disabled = false;
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    clearAllAuthErrors();

    const username = (regUsernameInput ? regUsernameInput.value : '').trim();
    const email = (regEmailInput ? regEmailInput.value : '').trim();
    const password = (regPasswordInput ? regPasswordInput.value : '').trim();
    const passwordConfirm = (regPasswordConfirmInput ? regPasswordConfirmInput.value : '').trim();

    let hasError = false;
    let firstInvalid = null;

    if (!username) {
      setFieldError(regUsernameInput, 'regUsernameError', 'Palun vali kasutajanimi');
      hasError = true;
      if (!firstInvalid) firstInvalid = regUsernameInput;
    } else if (username.length < 3 || username.length > 50) {
      setFieldError(regUsernameInput, 'regUsernameError', 'Kasutajanimi peab olema 3 kuni 50 tähemärki pikk');
      hasError = true;
      if (!firstInvalid) firstInvalid = regUsernameInput;
    } else if (!/^[a-zA-Z0-9_\-\.]+$/.test(username)) {
      setFieldError(regUsernameInput, 'regUsernameError', 'Kasutajanimi tohib sisaldada ainult tähti, numbreid, alakriipsu, sidekriipsu ja punkti');
      hasError = true;
      if (!firstInvalid) firstInvalid = regUsernameInput;
    }

    if (!password) {
      setFieldError(regPasswordInput, 'regPasswordError', 'Palun vali salasõna');
      hasError = true;
      if (!firstInvalid) firstInvalid = regPasswordInput;
    } else if (password.length < 8) {
      setFieldError(regPasswordInput, 'regPasswordError', 'Salasõna peab olema vähemalt 8 tähemärki pikk');
      hasError = true;
      if (!firstInvalid) firstInvalid = regPasswordInput;
    }

    if (!passwordConfirm) {
      setFieldError(regPasswordConfirmInput, 'regPasswordConfirmError', 'Palun korda salasõna');
      hasError = true;
      if (!firstInvalid) firstInvalid = regPasswordConfirmInput;
    } else if (password && password !== passwordConfirm) {
      setFieldError(regPasswordConfirmInput, 'regPasswordConfirmError', 'Salasõnad ei kattu');
      hasError = true;
      if (!firstInvalid) firstInvalid = regPasswordConfirmInput;
    }

    if (hasError) {
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    const btnSubmit = document.getElementById('btnSubmitRegister');
    if (btnSubmit) btnSubmit.disabled = true;

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, email })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setAuthError(data.error || 'Registreerimine ebaõnnestus!');
        if (data.error && data.error.toLowerCase().includes('kasutajanimi')) {
          setFieldError(regUsernameInput, 'regUsernameError', data.error);
        } else if (data.error && data.error.toLowerCase().includes('e-post')) {
          setFieldError(regEmailInput, 'regEmailError', data.error);
        }
        if (btnSubmit) btnSubmit.disabled = false;
        return;
      }

      currentUser = data.user;
      systemHasUsers = true;
      updateAdminHintVisibility();
      updateUserUI();
      hideAuthOverlay();
      if (registerForm) registerForm.reset();
      clearAllAuthErrors();
      await clearOfflineDataCache();
      showToast(`Konto loodud! Tere tulemast, ${currentUser.username}!`);
      // Laeme kasutaja andmed paralleelselt
      await Promise.all([
        loadCategories(),
        loadSources(),
        loadArticles()
      ]);
      renderSources();
    } catch (err) {
      console.error('Registreerimise viga:', err);
      setAuthError('Ühenduse viga serveriga. Palun proovi uuesti!');
    } finally {
      if (btnSubmit) btnSubmit.disabled = false;
    }
  }

  async function handleForgot(e) {
    e.preventDefault();
    clearAllAuthErrors();
    const identifier = (forgotIdentifierInput ? forgotIdentifierInput.value : '').trim();
    if (!identifier) {
      setFieldError(forgotIdentifierInput, 'forgotIdentifierError', 'Palun sisesta kasutajanimi või e-post');
      if (forgotIdentifierInput) forgotIdentifierInput.focus();
      return;
    }

    if (btnSubmitForgot) btnSubmitForgot.disabled = true;
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setAuthError(data.error || 'Taastamispäringu saatmine ebaõnnestus!');
        return;
      }
      setAuthSuccess(data.message || 'Kui sisestatud kasutajanimi või e-post eksisteerib, saadeti taastamislink.');
      if (forgotIdentifierInput) forgotIdentifierInput.value = '';
    } catch (err) {
      console.error('Parooli taastamise viga:', err);
      setAuthError('Ühenduse viga serveriga. Palun proovi uuesti!');
    } finally {
      if (btnSubmitForgot) btnSubmitForgot.disabled = false;
    }
  }

  async function handleReset(e) {
    e.preventDefault();
    clearAllAuthErrors();
    const newPassword = (resetNewPasswordInput ? resetNewPasswordInput.value : '').trim();
    const newPasswordConfirm = (resetNewPasswordConfirmInput ? resetNewPasswordConfirmInput.value : '').trim();

    let hasError = false;
    let firstInvalid = null;

    if (!newPassword) {
      setFieldError(resetNewPasswordInput, 'resetNewPasswordError', 'Palun vali uus salasõna');
      hasError = true;
      if (!firstInvalid) firstInvalid = resetNewPasswordInput;
    } else if (newPassword.length < 8) {
      setFieldError(resetNewPasswordInput, 'resetNewPasswordError', 'Salasõna peab olema vähemalt 8 tähemärki pikk');
      hasError = true;
      if (!firstInvalid) firstInvalid = resetNewPasswordInput;
    }

    if (!newPasswordConfirm) {
      setFieldError(resetNewPasswordConfirmInput, 'resetNewPasswordConfirmError', 'Palun korda salasõna');
      hasError = true;
      if (!firstInvalid) firstInvalid = resetNewPasswordConfirmInput;
    } else if (newPassword && newPassword !== newPasswordConfirm) {
      setFieldError(resetNewPasswordConfirmInput, 'resetNewPasswordConfirmError', 'Salasõnad ei kattu');
      hasError = true;
      if (!firstInvalid) firstInvalid = resetNewPasswordConfirmInput;
    }

    if (hasError) {
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    if (!activeResetToken) {
      setAuthError('Taastamiskood puudub või on kehtetu! Ava link oma e-kirjast uuesti.');
      return;
    }

    if (btnSubmitReset) btnSubmitReset.disabled = true;
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: activeResetToken, new_password: newPassword })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setAuthError(data.error || 'Parooli uuendamine ebaõnnestus!');
        return;
      }
      showToast('Parool edukalt muudetud! Saad nüüd sisse logida.', 'success');
      activeResetToken = '';
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, document.title, '/');
      }
      switchAuthTab('login');
      setAuthSuccess('Parool on edukalt muudetud! Sisesta oma uus parool.');
      if (resetPasswordForm) resetPasswordForm.reset();
    } catch (err) {
      console.error('Parooli uuendamise viga:', err);
      setAuthError('Ühenduse viga serveriga. Palun proovi uuesti!');
    } finally {
      if (btnSubmitReset) btnSubmitReset.disabled = false;
    }
  }

  // ==========================================================================
  // Automaatne andmebaasi sünkroonimine 5 minuti (300 000 ms) järel
  // (Serveri taustalõim uuendab baasi; brauser kontrollib ja sünkroonib loendurid ning voo)
  // ==========================================================================
  setInterval(() => {
    if (document.hidden || !currentUser) return;
    if (window.scrollY > 80 && articlesData && articlesData.length > 0) {
      // Kasutaja loeb praegu uudiseid: uuendame vasaku menüü loendurid ilma voogu liigutamata
      loadSources();
      return;
    }
    syncFeedFromDb({ showFeedback: false });
  }, 5 * 60 * 1000);

  // CSS animatsioonipöörlemine
  const style = document.createElement('style');
  style.innerHTML = `
    @keyframes spin { 100% { transform: rotate(360deg); } }
  `;
  document.head.appendChild(style);

  // ==========================================================================
  // Progressive Web App (PWA) ja Service Worker
  // ==========================================================================
  const btnInstallPwa = document.getElementById('btnInstallPwa');
  let deferredInstallPrompt = null;

  // 1. Service Workeri registreerimine
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => {
          console.log('[PWA] Service Worker edukalt registreeritud skoopiga:', reg.scope);
        })
        .catch((err) => {
          console.warn('[PWA] Service Workeri registreerimine ebaõnnestus:', err);
        });
    });
  }

  // 2. Paigaldamise nupu haldus (beforeinstallprompt)
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (btnInstallPwa) {
      btnInstallPwa.style.display = 'inline-flex';
    }
  });

  if (btnInstallPwa) {
    btnInstallPwa.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      const choiceResult = await deferredInstallPrompt.userChoice;
      if (choiceResult && choiceResult.outcome === 'accepted') {
        showToast('Täname! Lugeja lisatakse sinu seadmesse.');
        btnInstallPwa.style.display = 'none';
      }
      deferredInstallPrompt = null;
    });
  }

  window.addEventListener('appinstalled', () => {
    console.log('[PWA] Rakendus edukalt paigaldatud!');
    showToast('Lugeja on paigaldatud rakendusena!');
    if (btnInstallPwa) btnInstallPwa.style.display = 'none';
    deferredInstallPrompt = null;
  });

  // 3. Võrgu oleku jälgimine (Online / Offline teavitused)
  let wasOffline = false;
  window.addEventListener('online', () => {
    if (wasOffline) {
      showToast('Võrguühendus taastatud!', 'success');
      wasOffline = false;
    }
    if (statusIndicatorEl) {
      statusIndicatorEl.innerHTML = `<span class="status-dot"></span> Sünkroonis`;
    }
    // Ära kutsu siin handleRefresh(), sest mobiilis tekitab see äppide vahetamisel
    // pooleli oleva uudisvoo ootamatu tühjendamise ja kerimishüppeid!
  });

  window.addEventListener('offline', () => {
    wasOffline = true;
    showToast('Oled võrguühenduseta. Kuvatakse salvestatud uudiseid.', 'error');
    if (statusIndicatorEl) {
      statusIndicatorEl.innerHTML = `<span class="status-dot updating" style="background:#F59E0B;"></span> Offline`;
    }
  });

  // Algne käivitus (kontrolli esmalt autentimist)
  async function initApp() {
    const isAuthed = await checkAuth();
    if (!isAuthed) return;

    loadCollapsedCategories();
    // Laeme kategooriad, allikad ja artiklid paralleelselt
    await Promise.all([
      loadCategories(),
      loadSources(),
      loadArticles()
    ]);
    renderSources();
  }
  initApp();
});
