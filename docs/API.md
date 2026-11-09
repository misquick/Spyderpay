# API для магазина

Базовый адрес — ваш домен, например `https://mypay.duckdns.org/api`. Все запросы и ответы в JSON. Суммы передаются строками, чтобы не терять точность.

## Аутентификация

Запросы магазина подписываются API-ключом, который выдаётся при открытии магазина:

```http
Authorization: Bearer cpk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Ключ хранится на сервере только в виде SHA-256 хэша, поэтому восстановить его нельзя. Держите ключ на сервере магазина и никогда не встраивайте в код сайта.

## Счета

### Создать счёт

```http
POST /api/invoices
```

| Поле | Тип | Обязательно | Описание |
|---|---|---|---|
| `amount` | string | да | Сумма в валюте оплаты: ETH — до 6 знаков (`"0.0015"`, минимум `0.000001`), USDC — до 2 знаков (`"25.50"`, минимум `0.01`). |
| `payTo` | string | нет | Адрес получателя для этого счёта. По умолчанию — адрес выплат магазина. |
| `description` | string | нет | Что оплачивают. Видно покупателю. До 200 символов. |
| `orderId` | string | нет | Номер заказа в вашей системе. Покупателю не показывается, приходит в вебхуке. |
| `chainId` | number | нет | Сеть. По умолчанию первая из `CHAINS`. |
| `redirectUrl` | string | нет | Куда вернуть покупателя после оплаты. |
| `expiresInMinutes` | number | нет | Срок оплаты, 5–1440. По умолчанию `INVOICE_TTL_MINUTES`. |

```bash
curl -X POST https://mypay.duckdns.org/api/invoices \
  -H "Authorization: Bearer $CRYPTOPAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"amount": "25.00", "description": "Заказ №1024", "orderId": "1024"}'
```

Ответ `201`:

```json
{
  "invoice": {
    "id": "0d538c26-2382-43fe-82ec-6e3ba57576eb",
    "status": "pending",
    "amount": "25.00",
    "payAmount": "25.004371",
    "payAmountUnits": "25004371",
    "token": { "address": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", "symbol": "USDC", "decimals": 6 },
    "network": { "chainId": 84532, "name": "Base Sepolia", "testnet": true, "explorerUrl": "https://sepolia.basescan.org", "faucetUrl": "https://faucet.circle.com" },
    "payTo": "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
    "description": "Заказ №1024",
    "orderId": "1024",
    "redirectUrl": null,
    "payment": null,
    "confirmations": 0,
    "requiredConfirmations": 5,
    "paymentUrl": "https://mypay.duckdns.org/pay/0d538c26-2382-43fe-82ec-6e3ba57576eb",
    "createdAt": "2026-11-07T15:53:00.000Z",
    "expiresAt": "2026-11-07T16:23:00.000Z",
    "paidAt": null
  }
}
```

Отправьте покупателю `paymentUrl`.

**Почему `payAmount` чуть больше `amount`.** К сумме добавляется уникальный «хвост» меньше одного цента (здесь `0.004371`). У каждого открытого счёта на один адрес своя точная сумма, поэтому сервер однозначно понимает, какой счёт оплачен, даже если покупатель отправил перевод вручную, без нашей страницы. Сравнивать с ценой заказа нужно `amount`.

### Список, просмотр, отмена

```http
GET  /api/invoices?limit=50        → { "invoices": [ ... ] }  (новые первыми, limit до 200)
GET  /api/invoices/{id}            → { "invoice": { ... } }
POST /api/invoices/{id}/cancel     → { "invoice": { ... } }   (только из статуса pending)
```

### Статусы

| `status` | Значение |
|---|---|
| `pending` | Ждём оплату |
| `confirming` | Перевод найден, ждём `requiredConfirmations` подтверждений сети |
| `paid` | Оплачено, можно отгружать заказ |
| `expired` | Срок вышел, оплаты не было |
| `cancelled` | Отменён магазином |

## Аккаунт магазина

```http
POST  /api/merchants        { name, payoutAddress, webhookUrl? }  → { merchant, apiKey }   без ключа, если регистрация открыта
GET   /api/merchants/me                                           → { merchant }
PATCH /api/merchants/me     { name?, payoutAddress?, webhookUrl? } → { merchant }
```

Новый `payoutAddress` применяется только к счетам, созданным после изменения.

## Публичные методы (страница оплаты)

```http
GET  /api/public/invoices/{id}                       → { invoice }  без orderId, с merchant.name
POST /api/public/invoices/{id}/payments  { txHash }  → { invoice }  сообщить о транзакции
GET  /api/config                                     → сети, токены, открыта ли регистрация
GET  /api/health                                     → { ok: true }
```

## Ошибки

```json
{ "error": { "code": "INVALID_AMOUNT", "message": "Minimum amount is 0.01" } }
```

| HTTP | `code` | Когда |
|---|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_AMOUNT`, `UNSUPPORTED_CHAIN`, `INVALID_TX_HASH` | Неверные данные. В `details` указано поле. |
| 401 | `UNAUTHORIZED` | Нет ключа или он неверный |
| 403 | `REGISTRATION_CLOSED` | `ALLOW_REGISTRATION=false` |
| 404 | `NOT_FOUND` | Счёт не найден или принадлежит другому магазину |
| 409 | `INVALID_STATE`, `INVOICE_NOT_PAYABLE`, `TX_NOT_FOUND`, `TX_ALREADY_USED` | Конфликт статуса или транзакция ещё не в блоке |
| 422 | `TX_REVERTED`, `NO_MATCHING_TRANSFER` | Транзакция не оплачивает этот счёт |
| 429 | `RATE_LIMITED` | Слишком много запросов |

## Вебхуки

Если у магазина задан `webhookUrl`, сервер отправляет `POST` при смене статуса.

| Событие | Когда |
|---|---|
| `invoice.paid` | Счёт оплачен и подтверждён |
| `invoice.expired` | Срок вышел без оплаты |

```http
POST https://shop.example/payments
Content-Type: application/json
X-CryptoPay-Event: invoice.paid
X-CryptoPay-Delivery: 5f0c…
X-CryptoPay-Signature: t=1794067842,v1=9a3b…

{ "id": "5f0c…", "type": "invoice.paid", "createdAt": "…", "data": { …счёт, как в API… } }
```

Ответьте любым кодом `2xx` в течение 10 секунд. Иначе доставка повторится через 30 с, 1, 2, 4 минуты и так далее, до 6 часов между попытками, всего 10 попыток. Один и тот же `X-CryptoPay-Delivery` может прийти повторно, поэтому обрабатывайте событие идемпотентно: если заказ уже отмечен оплаченным, ничего не делайте.

### Проверка подписи

Подпись — HMAC-SHA256 от строки `{t}.{тело запроса}` с секретом `whsec_…` из настроек. Проверяйте **сырое** тело запроса, до разбора JSON.

Node.js (Express):

```js
import crypto from 'node:crypto';
import express from 'express';

const app = express();
const SECRET = process.env.CRYPTOPAY_WEBHOOK_SECRET;

app.post('/payments', express.raw({ type: 'application/json' }), (req, res) => {
  const header = req.get('X-CryptoPay-Signature') ?? '';
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const body = req.body.toString('utf8');
  const expected = crypto.createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex');

  const fresh = Math.abs(Date.now() / 1000 - Number(t)) < 300;
  const valid = v1 && v1.length === expected.length && crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
  if (!fresh || !valid) return res.sendStatus(400);

  const event = JSON.parse(body);
  if (event.type === 'invoice.paid') {
    // отметить заказ event.data.orderId оплаченным, если он ещё не отмечен
  }
  res.sendStatus(200);
});
```

Python (Flask):

```python
import hmac, hashlib, time, json
from flask import Flask, request, abort

app = Flask(__name__)
SECRET = b"whsec_..."

@app.post("/payments")
def payments():
    parts = dict(p.split("=", 1) for p in request.headers.get("X-CryptoPay-Signature", "").split(","))
    body = request.get_data()
    expected = hmac.new(SECRET, f"{parts.get('t')}.".encode() + body, hashlib.sha256).hexdigest()
    if abs(time.time() - int(parts.get("t", 0))) > 300 or not hmac.compare_digest(expected, parts.get("v1", "")):
        abort(400)
    event = json.loads(body)
    if event["type"] == "invoice.paid":
        pass  # отметить заказ event["data"]["orderId"] оплаченным
    return "", 200
```
