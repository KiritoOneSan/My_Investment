// ===== Навигация =====
const screens = {
  summary:    { el: 'screen-summary',    title: 'Сводка',    isRoot: true },
  portfolios: { el: 'screen-portfolios', title: 'Портфели',  isRoot: true },
  more:       { el: 'screen-more',       title: 'Ещё',       isRoot: true },
  graphs:     { el: 'screen-graphs',     title: 'Графики',   isRoot: false },
  import:     { el: 'screen-import',     title: 'Импорт',    isRoot: false },
  taxes:      { el: 'screen-taxes',      title: 'Налоги',    isRoot: false },
  trades:     { el: 'screen-trades',     title: 'Сделки',    isRoot: false },
  operations: { el: 'screen-operations', title: 'Операции',  isRoot: false },
  settings:   { el: 'screen-settings',   title: 'Настройки', isRoot: false },
};

let currentScreen = 'summary';
const history = [];

function navigate(screenKey, addToHistory = true) {
  const screen = screens[screenKey];
  if (!screen) return;

  // Скрыть все экраны, показать нужный
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screen.el).classList.add('active');

  // Заголовок
  document.getElementById('appBarTitle').textContent = screen.title;

  // Кнопка "Назад"
  const backBtn = document.getElementById('backBtn');
  if (screen.isRoot) {
    backBtn.classList.add('hidden');
    history.length = 0; // Сброс истории при переходе на корневой экран
  } else {
    backBtn.classList.remove('hidden');
    if (addToHistory) history.push(currentScreen);
  }

  // Активная вкладка нижней навигации
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.nav === screenKey);
  });

  // Прокрутить контент наверх
  document.getElementById('content').scrollTop = 0;

  currentScreen = screenKey;
}

function goBack() {
  const prev = history.pop();
  if (prev) {
    navigate(prev, false);
  } else {
    navigate('more', false); // fallback
  }
}

// ===== Обработчики =====
document.addEventListener('DOMContentLoaded', () => {
  // Нижняя навигация
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.nav));
  });

  // Пункты меню "Ещё"
  document.querySelectorAll('.menu-item').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.nav));
  });

  // Кнопка "Назад"
  document.getElementById('backBtn').addEventListener('click', goBack);

  // Переключатель "Сводно / По счетам"
  document.querySelectorAll('.toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // TODO: Здесь позже будет логика переключения режима
    });
  });

  // Стартовый экран
  navigate('summary');
});

// ===== Обработка системной кнопки "Назад" на Android =====
window.addEventListener('popstate', () => {
  if (!screens[currentScreen].isRoot) {
    goBack();
  }
});

// Добавляем фиктивную запись в history, чтобы перехватывать кнопку "Назад"
history.pushState({}, '');
window.addEventListener('popstate', () => {
  if (!screens[currentScreen].isRoot) {
    goBack();
    history.pushState({}, '');
  }
});