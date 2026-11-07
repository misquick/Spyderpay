# SOLID в этом проекте

**SOLID** — пять принципов проектирования классов, которые сформулировал Роберт Мартин. Они отвечают на один вопрос: *как писать код, который можно менять, не ломая то, что уже работает*.

Для платёжной системы это особенно важно. Сети, кошельки и RPC-провайдеры будут добавляться и меняться, а логика «засчитать платёж» должна оставаться неизменной и проверенной тестами.

| Буква | Принцип | Коротко |
|---|---|---|
| **S** | Single Responsibility — единственная ответственность | У класса одна причина для изменения |
| **O** | Open/Closed — открытость/закрытость | Новое поведение добавляется новым кодом, а не правкой старого |
| **L** | Liskov Substitution — подстановка Барбары Лисков | Любую реализацию интерфейса можно подставить вместо другой |
| **I** | Interface Segregation — разделение интерфейсов | Много маленьких интерфейсов лучше одного большого |
| **D** | Dependency Inversion — инверсия зависимостей | Бизнес-логика зависит от абстракций, а не от конкретных библиотек |

Слои сервера (`server/src`):

```
domain/          правила предметной области: счёт, статусы, суммы, подпись вебхука. Без зависимостей.
ports/           интерфейсы: что нужно бизнес-логике от базы, блокчейна, HTTP
services/        бизнес-логика: создать счёт, найти платёж, подтвердить, отправить вебхук
infrastructure/  реализации портов: PostgreSQL, viem (EVM), fetch
http/            Express: маршруты, валидация, ошибки
worker/          цикл фоновых задач
container.ts     точка сборки: единственное место, где создаются конкретные классы
```

Зависимости направлены внутрь: `http` и `infrastructure` знают о `services` и `ports`, но `services` и `domain` ничего не знают о Express, PostgreSQL или viem.

---

## S — Single Responsibility

> У модуля должна быть только одна причина для изменения.

Обработку платежа легко написать одной функцией на 300 строк: получить транзакцию, сверить сумму, обновить базу, отправить вебхук. Но тогда смена формата вебхука или RPC-провайдера заставит трогать код, который решает, засчитан ли платёж, а это самое опасное место системы.

Здесь каждая часть отдельно:

| Класс | Единственная задача | Меняется, когда… |
|---|---|---|
| `InvoiceService` | создать, показать и отменить счёт | меняются правила выставления счёта |
| `PaymentService` | связать транзакцию со счётом | меняются правила зачисления |
| `PaymentScanner` | найти переводы в новых блоках, истечь просроченные | меняется способ чтения цепи |
| `ConfirmationTracker` | дождаться подтверждений и защититься от реорга | меняется политика подтверждений |
| `WebhookPublisher` | положить событие в outbox | меняется формат события |
| `WebhookDispatcher` | доставить, подписать, повторить | меняется политика доставки |
| `Presenter` | превратить объекты в JSON | меняется формат ответа API |
| `http/routes.ts` | разобрать HTTP-запрос и вызвать сервис | меняются URL и коды ответов |

Правила, которые не зависят ни от чего, вынесены в чистые функции `domain/`: проверка «подходит ли перевод к счёту» — это `matchTransfer` в `domain/invoice.ts`. Её проверяют юнит-тесты без базы и без сети.

```ts
// server/src/domain/invoice.ts
export function matchTransfer(invoice: Invoice, transfer: TokenTransfer): MatchFailure | null {
  if (transfer.chainId !== invoice.chainId) return 'wrong_chain';
  if (transfer.token !== invoice.token.address) return 'wrong_token';
  if (transfer.to !== invoice.payTo) return 'wrong_recipient';
  if (transfer.value !== invoice.amountUnits) return 'wrong_amount';
  // …окно времени
  return null;
}
```

## O — Open/Closed

> Модуль открыт для расширения, но закрыт для изменения.

**Новая сеть.** Чтобы добавить, например, Arbitrum, не нужно искать по коду `if (chainId === ...)`. Достаточно одной строки в реестре сетей `config/chains.ts` и значения в `CHAINS`:

```ts
const PRESETS: Record<number, Preset> = {
  [baseSepolia.id]: { chain: baseSepolia, usdc: '0x036C…CF7e', confirmations: 5, faucetUrl: CIRCLE_FAUCET },
  [sepolia.id]:     { chain: sepolia,     usdc: '0x1c7D…7238', confirmations: 3, faucetUrl: CIRCLE_FAUCET },
  // [arbitrumSepolia.id]: { chain: arbitrumSepolia, usdc: '0x75fa…AA4d', confirmations: 5 },
};
```

Веб-клиент получает список сетей с сервера (`GET /api/config`), поэтому фронтенд тоже не меняется.

**Новая фоновая задача.** `Worker` принимает список объектов `Job` и не знает, что они делают. Чтобы добавить задачу, например ежедневный отчёт, её нужно зарегистрировать в `container.ts`. `Worker.ts` при этом не меняется:

```ts
jobs.push({ name: 'daily-report', run: () => reports.run() });
```

**Новый тип блокчейна.** Для Solana (Phantom) пишется класс `SolanaChainClient implements ChainClient`. Сервисы `PaymentService`, `PaymentScanner` и `ConfirmationTracker` уже работают через интерфейс и менять их не придётся.

## L — Liskov Substitution

> Объекты подтипа должны заменять объекты базового типа без изменения правильности программы.

Интерфейс задаёт не только сигнатуры, но и **поведение**, на которое полагаются вызывающие. Например, у `InvoiceRepository.transition` контракт такой:

```ts
/**
 * Compare-and-set: applies only if the invoice is still in `from`.
 * Returns the updated invoice, or `null` if someone else changed it first.
 * @throws PaymentAlreadyUsedError if the payment is already linked to another invoice.
 */
transition(id, from, to, changes?): Promise<Invoice | null>;
```

Обе реализации соблюдают его одинаково:

- `PgInvoiceRepository` — через `UPDATE … WHERE status = $from` и уникальный индекс;
- `MemoryInvoices` в `test/fakes.ts` — через проверку в памяти.

Поэтому `PaymentService` и сканер работают одинаково с любой из них, а тесты на фейках действительно проверяют логику, которая потом работает с PostgreSQL. Если бы фейк, например, не возвращал `null` при гонке, тесты проходили бы, а на продакшене платёж засчитывался бы дважды. Это и есть нарушение LSP.

То же с `ChainClient`: `EvmChainClient` (настоящая сеть через viem) и `FakeChain` (тестовая цепочка) взаимозаменяемы, включая поведение «транзакция не найдена → `{ status: 'not_found' }`, а не исключение».

## I — Interface Segregation

> Клиенты не должны зависеть от методов, которыми не пользуются.

Доступ к блокчейну разбит на три маленьких интерфейса (`ports/blockchain.ts`):

```ts
interface TransactionInspector { inspectTransaction(txHash): Promise<TxInspection> }
interface BlockReader          { getHead(): Promise<BlockRef>; getBlock(n): Promise<BlockRef> }
interface TransferFinder       { findTransfers(query): Promise<TokenTransfer[]> }
```

Каждый сервис требует только то, чем пользуется:

```ts
class PaymentScanner      { constructor(chain, client: TransferFinder & BlockReader, …) }
class ConfirmationTracker { constructor(chain, client: TransactionInspector & BlockReader, …) }
```

Что это даёт:

- по конструктору видно, что `ConfirmationTracker` никогда не сканирует логи;
- для теста не нужно реализовывать лишние методы;
- провайдер, который умеет только читать квитанции, подходит для `PaymentService`, даже если `eth_getLogs` у него нет.

## D — Dependency Inversion

> Модули верхнего уровня не должны зависеть от модулей нижнего уровня. Оба должны зависеть от абстракций.

Бизнес-логика (`services/`) не импортирует ни `pg`, ни `viem`, ни `express`. Она получает зависимости через конструктор в виде интерфейсов из `ports/`:

```ts
// server/src/services/PaymentService.ts
export class PaymentService {
  constructor(
    private readonly invoices: InvoiceRepository, // а не PgInvoiceRepository
    private readonly chainClients: ChainClients,  // а не viem
  ) {}
}
```

Конкретные классы создаются в одном месте — `container.ts` (composition root):

```ts
const repos = createPgRepositories(pool);
const chainClients = new EvmChainClients(chains);
const payments = new PaymentService(repos.invoices, chainClients);
```

Что это даёт на практике:

1. **Тесты без инфраструктуры.** `test/payment-flow.test.ts` прогоняет весь путь платежа — создание счёта, оплату, подтверждения, реорг, истечение, вебхук с подписью — на фейках за доли секунды.
2. **Замена поставщика.** Переезд с публичного RPC на Alchemy — это переменная окружения. Переезд с PostgreSQL на другую БД — новый класс-репозиторий, сервисы не трогаем.
3. **Атомарность без утечки SQL в логику.** Сервису нужно «сменить статус и записать вебхук в одной транзакции». Он выражает это через абстракцию `UnitOfWork`, а не через `BEGIN/COMMIT`:

```ts
await this.uow.run(async (repos) => {
  const paid = await repos.invoices.transition(id, 'confirming', 'paid', { paidAt });
  if (paid) await this.publisher.publish(repos, paid, 'invoice.paid');
});
```

---

## Зачем всё это

Без SOLID проект тоже заработает, но первая же доработка (вторая сеть, новый формат вебхука, другой RPC) превратится в правку десятка мест и риск сломать зачисление денег. С SOLID:

- каждое изменение затрагивает **один** файл, ответственный за эту область;
- логику платежей можно проверить тестами **до** выкладки;
- код читается по слоям: чтобы понять, как засчитывается платёж, достаточно `domain/invoice.ts` и `services/PaymentService.ts`.

Принципы не самоцель: в маленьких местах (например, `format.ts` на фронтенде) лишние абстракции не нужны. SOLID применён там, где система будет меняться: блокчейн, хранение, доставка уведомлений.
