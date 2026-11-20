// Show the deployment's actual storage lifetime, not a promised retention period.
(() => {
  fetch('/api/career/status', { cache: 'no-store' })
    .then(response => response.ok ? response.json() : null)
    .then(config => {
      if (!config?.ephemeral || document.getElementById('demoStorageNotice')) return;
      const notice = document.createElement('p');
      notice.id = 'demoStorageNotice'; notice.className = 'warning';
      notice.setAttribute('role', 'note');
      notice.textContent = '临时展示环境：仅填写虚构资料。服务器休眠、重启或重新部署后，活动、草稿和提交可能丢失；默认保存期限不代表数据一定保留到期。';
      document.querySelector('main')?.prepend(notice);
    }).catch(() => { /* The page's own status UI handles an unavailable records API. */ });
})();
