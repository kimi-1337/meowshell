# Проверки интерфейса, 2026-09-09

Проверено через Playwright CLI, подключённый по CDP к Electron 41.10.5.
Запущен исходный проект, не Windows-пакет. ОС: Linux x64, Xvfb.
Отдельный пустой профиль: `/tmp/meowshell-audit-ui-snjDrt`.
Параметры тестового процесса: `--no-sandbox --disable-gpu
--remote-debugging-port=19337 --user-data-dir=<отдельный профиль>`.
Отключение sandbox требуется для данного root-контейнера; это НЕ проверка
защищённости renderer sandbox и НЕ рекомендация для поставляемой сборки.

Использовался навык `/root/.codex/skills/playwright/SKILL.md`:
сначала снимок доступности, затем действия и диагностические `eval`.
Никаких подключений к реальным SSH-серверам и команд в настоящем shell.
Вставки проверены на виртуальной вкладке без backend-сессии,
а отправка ввода заменена сбором значений в памяти.

## A10 — закрытие первого запуска через Escape

На свежем профиле появился диалог Welcome. Через CLI выполнен `press Escape`.
Затем:

```js
() => ({
  onboardingComplete: settings.onboardingComplete ?? null,
  snapshotReady: __snapshotReady,
  tabs: tabs.size,
  dialogs: document.querySelectorAll('.modal-backdrop:not(.hidden)').length
})
```

Результат:

```json
{"onboardingComplete":null,"snapshotReady":false,"tabs":0,"dialogs":0}
```

Окно работает, но асинхронная инициализация ожидает уже закрытый диалог.
Это не зависание всего renderer: проблема в незавершённой цепочке запуска
и невключённом сохранении снимков вкладок.

## A17 — нативное событие paste обходит pasteGuard

После предыдущей проверки выполнено:

```js
() => {
  window.auditWrites = [];
  routeInput = (id, data) => window.auditWrites.push({ id, data });
  addTab('audit-virtual', 'Audit virtual terminal', 'local');
  const transfer = new DataTransfer();
  transfer.setData('text/plain', 'echo AUDIT_ONE\necho AUDIT_TWO');
  tabs.get('audit-virtual').term.textarea.dispatchEvent(
    new ClipboardEvent('paste', {
      clipboardData: transfer, bubbles: true, cancelable: true
    })
  );
  return {
    writes: window.auditWrites,
    guardEnabled: settings.pasteGuard !== false,
    dialogs: document.querySelectorAll('.modal-backdrop:not(.hidden)').length
  };
}
```

Результат:

```json
{
  "writes":[{"id":"audit-virtual","data":"echo AUDIT_ONE\recho AUDIT_TWO"}],
  "guardEnabled":true,
  "dialogs":0
}
```

Это проверка реального DOM/xterm-обработчика синтетическим ClipboardEvent.
Физическая комбинация Shift+Insert на Windows отдельно не проверялась;
её следует включить в приёмочную проверку вместе с Ctrl+Shift+V.

## A18 — Ctrl+V внутри настроек вызывает терминальную вставку

В продолжение того же сеанса:

```js
() => {
  let called = false;
  handlePaste = () => { called = true; };
  openSettingsTab();
  const input = document.querySelector('#st-fontfamily');
  const event = new KeyboardEvent('keydown', {
    key: 'v', code: 'KeyV', ctrlKey: true, bubbles: true, cancelable: true
  });
  input.dispatchEvent(event);
  return {
    activeId, focusedSessId,
    calledTerminalPaste: called,
    prevented: event.defaultPrevented,
    inputInsideTermPane: !!input.closest('.term-pane')
  };
}
```

Результат:

```json
{
  "activeId":"__settings__",
  "focusedSessId":"audit-virtual",
  "calledTerminalPaste":true,
  "prevented":true,
  "inputInsideTermPane":true
}
```

`handlePaste` подменён, чтобы не читать настоящий clipboard. Направление
дальнейшей передачи установлено по оригинальному `handlePaste`:
он выбирает `focusedSessId`, если этот ID ещё присутствует в `paneOf`.
Реальная запись в скрытый PTY/SSH не выполнялась.

После проверок тестовый Electron закрыт. Эти изменения JS были только
в памяти его renderer; исходные файлы приложения не изменены.

## Повторная проверка после исправлений

Исправленная рабочая копия повторно проверена 9 сентября 2026 года в отдельном
профиле и настоящем Electron renderer. Результат:

```json
{
  "onboarding": { "dialogs": 0, "snapshotReady": true },
  "settingsCtrlV": { "calledTerminalPaste": false, "prevented": false },
  "nativeMultilinePaste": { "writes": [], "guardedDialog": true }
}
```

То есть Escape/клик вне onboarding завершают цепочку запуска, Ctrl+V в поле
настроек остаётся обычным редактированием поля, а нативное многострочное paste
не отправляется в терминал до подтверждения. Для теста вставки backend был
заменён сбором значений в памяти; команды не выполнялись.
