# Tikitok on Render without using the ws module

Это мини-проект для Render с интерфейсом в стиле TikTok и live-обновлениями без `ws`.

## Что внутри

- `server.js` — HTTP сервер на стандартных модулях Node.js
- `public/index.html` — функциональный интерфейс
- `render.yaml` — минимальный blueprint для Render

## Как запустить локально

```bash
node server.js
```

Открой `http://localhost:10000`.

## Как задеплоить на Render

1. Залей папку в GitHub.
2. Создай Web Service на Render.
3. Start Command: `node server.js`
4. Render сам передаст `PORT`, сервер уже слушает `0.0.0.0`.

## Что работает

- лайвы через SSE / EventSource
- посты
- лайки
- комментарии
- индикатор онлайна
- интерфейс в стиле первого мокапа

## Почему без ws

Потому что тут вообще не используется `ws` и нет внешних зависимостей. Для server push используется SSE.
