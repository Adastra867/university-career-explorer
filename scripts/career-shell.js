(() => {
  const workspace = '/index.html';
  const routes = {
    home: ['我的首页', '⌂', workspace],
    intelligence: ['职业规划 AI', '✦', workspace + '#intelligence'],
    direction: ['方向探索', '✧', workspace + '#direction'],
    ability: ['能力画像', '◫', workspace + '#ability'],
    jobs: ['岗位匹配', '↗', workspace + '#jobs'],
    sprint: ['求职冲刺', '◎', '/career-prep.html'],
    roadmap: ['我的职业路线', '⌁', workspace + '#roadmap'],
    reports: ['我的报告', '▤', workspace + '#reports'],
    history: ['历史记录', '◷', workspace + '#history'],
    profile: ['统一资料与提交', '◉', '/start#profileCard'],
  };
  const main = document.querySelector('main');
  const footer = document.querySelector('body > footer');
  const shell = document.createElement('div');
  shell.className = 'career-shell';
  const navLink = (key, extra = '') => {
    const [label, icon, href] = routes[key];
    return `<a class="career-nav-link ${extra}" href="${href}" data-career-nav="${key}"><span aria-hidden="true" class="career-nav-icon">${icon}</span><span>${label}</span></a>`;
  };
  shell.innerHTML = `
    <nav class="career-nav no-print" aria-label="主导航">
      <a class="career-wordmark" href="${workspace}"><span aria-hidden="true">✦</span>职途星轨</a>
      <div class="career-nav-primary">
        ${navLink('home')}
        <div class="career-nav-planning" role="group" aria-labelledby="careerPlanningLabel">
          <p class="career-nav-label" id="careerPlanningLabel">职业规划</p>
          ${navLink('intelligence', 'career-desktop-link')}
          ${['direction', 'ability', 'jobs'].map(key => navLink(key)).join('')}
          ${navLink('sprint', 'career-desktop-link')}
          ${navLink('profile', 'career-desktop-link')}
        </div>
        <button class="career-nav-link career-more" type="button" aria-expanded="false" aria-controls="careerMore"><span aria-hidden="true" class="career-nav-icon">···</span><span>更多</span></button>
      </div>
      <div id="careerMore" class="career-nav-secondary">
        <div class="career-nav-mobile-planning" role="group" aria-labelledby="careerMobilePlanningLabel">
          <p class="career-nav-label" id="careerMobilePlanningLabel">职业规划</p>
          ${['intelligence', 'sprint', 'profile'].map(key => navLink(key, 'career-mobile-link')).join('')}
        </div>
        <div role="group" aria-labelledby="careerPersonalLabel">
          <p class="career-nav-label" id="careerPersonalLabel">个人空间</p>
          ${['roadmap', 'reports', 'history'].map(key => navLink(key)).join('')}
        </div>
      </div>
    </nav>
    <div class="career-body">
      <header class="career-top no-print">
        <div class="career-top-inner">
          <div class="career-page-labels">
            <p class="career-breadcrumb"><a href="${workspace}">我的首页</a><span aria-hidden="true">/</span><span id="careerCrumb"></span></p>
            <h1 id="careerPageTitle" tabindex="-1"></h1>
          </div>
          <span id="careerPageStatus" class="career-status" role="status" hidden></span>
          <button type="button" class="career-assistant-trigger" id="floatingAssistant" aria-label="打开星轨答疑" aria-expanded="false" aria-controls="assistantPanel"><span aria-hidden="true">✧</span><span>星轨答疑</span></button>
        </div>
      </header>
    </div>`;
  main.before(shell);
  const body = shell.querySelector('.career-body');
  body.append(main);
  if (footer) body.append(footer);
  main.id ||= 'careerMain';
  document.body.classList.add('career-shell-page');

  const more = shell.querySelector('.career-more');
  const menu = shell.querySelector('#careerMore');
  function closeMenu() {
    more.setAttribute('aria-expanded', 'false');
    menu.classList.remove('is-open');
  }
  more.addEventListener('click', () => {
    more.setAttribute('aria-expanded', String(menu.classList.toggle('is-open')));
  });
  document.addEventListener('click', event => {
    if (!menu.contains(event.target) && !more.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.classList.contains('is-open')) {
      closeMenu();
      more.focus();
    }
  });

  const titleNode = document.getElementById('careerPageTitle');
  const breadcrumb = shell.querySelector('.career-breadcrumb');
  const crumb = document.getElementById('careerCrumb');
  const status = document.getElementById('careerPageStatus');
  function setStatus(text) {
    status.textContent = text || '';
    status.hidden = !text;
    status.dataset.state = text || '';
  }
  function setPage(key, title = routes[key][0], progress = '', focus = false) {
    titleNode.textContent = title;
    breadcrumb.hidden = key === 'home';
    crumb.textContent = title === routes[key][0] ? title : routes[key][0];
    setStatus(progress);
    document.title = title + ' · 职途星轨';
    shell.querySelectorAll('[data-career-nav]').forEach(link => {
      if (link.dataset.careerNav === key) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    more.classList.toggle('is-current', ['intelligence', 'sprint', 'roadmap', 'reports', 'history', 'profile'].includes(key));
    closeMenu();
    if (focus) titleNode.focus({ preventScroll: true });
  }
  function animate(element) {
    element.classList.remove('career-enter');
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      void element.offsetWidth;
      element.classList.add('career-enter');
    }
  }
  const recentKey = 'careerWorkspaceRecent';
  function remember(href, label) {
    try { localStorage.setItem(recentKey, JSON.stringify({ href, label })); } catch {}
  }
  function recent() {
    try { return JSON.parse(localStorage.getItem(recentKey)); } catch { return null; }
  }
  const resultKey = 'careerWorkspaceRecentAdvice';
  function rememberAdvice(href, label) {
    try { localStorage.setItem(resultKey, JSON.stringify({ href, label, time: Date.now() })); } catch {}
  }
  function recentAdvice() {
    try { return JSON.parse(localStorage.getItem(resultKey)); } catch { return null; }
  }
  window.CareerShell = { shell, setPage, setStatus, animate, remember, recent, rememberAdvice, recentAdvice };
  setPage(document.body.dataset.careerPage || 'home');
  if (document.body.dataset.careerPage) animate(main);
})();
