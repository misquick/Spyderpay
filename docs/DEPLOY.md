# Запуск на облачном сервере

Проекту нужен сервер, который работает **круглосуточно**: фоновый воркер всё время читает блокчейн, ищет платежи и отправляет уведомления. Поэтому лучший вариант — обычная виртуальная машина с Docker, а не «засыпающий» бесплатный PaaS.

## Какой хостинг выбрать

| Вариант | Цена | Подходит? | Комментарий |
|---|---|---|---|
| **Oracle Cloud Always Free** (VM на Arm) | 0 ₽ | ✅ Рекомендую | Единственный бесплатный вариант с настоящей постоянно работающей VM. Сейчас это 2 ядра Arm и 12 ГБ памяти, нужна банковская карта для проверки. |
| Любой VPS: Hetzner, DigitalOcean, Vultr, местный хостинг | ~4–6 $/мес | ✅ | Те же шаги, что для Oracle, начиная с шага 4. Самый беспроблемный путь. |
| Render (бесплатный) + Neon + Vercel | 0 ₽ | ⚠️ Только демо | Бесплатный сервис Render засыпает после 15 минут без запросов, холодный старт 30+ секунд. Пока сервер спит, воркер не ищет платежи. |
| Google Cloud Run, Azure Container Apps | 0 ₽ в пределах лимита | ⚠️ | Контейнер запускается только на запрос, фоновый воркер так не работает. |
| Heroku, Fly.io, Glitch | — | ❌ | Бесплатных тарифов больше нет. |

Ниже пошагово для Oracle Cloud. Для обычного VPS пропустите шаги 1–3.

---

## Шаг 1. Аккаунт Oracle Cloud

1. Зарегистрируйтесь на [oracle.com/cloud/free](https://www.oracle.com/cloud/free/). Карта нужна только для проверки, списаний в пределах Always Free нет. Предоплаченные и виртуальные карты обычно не принимаются.
2. **Home region** выбирается один раз и навсегда. Бесплатные Arm-машины есть не во всех регионах в наличии. Если при создании VM появится *Out of capacity*, повторите позже или выберите другой Availability Domain.

## Шаг 2. Виртуальная машина

**Compute → Instances → Create instance**:

- **Image:** Canonical Ubuntu 24.04.
- **Shape:** *Ampere* → `VM.Standard.A1.Flex`, 2 OCPU, 12 GB RAM (весь бесплатный лимит) или 1 OCPU / 6 GB.
- **Networking:** оставьте создание новой VCN и *Assign a public IPv4 address*.
- **SSH keys:** *Generate a key pair for me* → скачайте приватный ключ (`.key`).

После создания скопируйте **Public IP address**.

> Oracle может забрать простаивающую бесплатную машину, если 7 дней подряд загрузка ниже 20%. Чтобы этого не случилось, аккаунт можно перевести в *Pay As You Go*: ресурсы в пределах Always Free остаются бесплатными, но обязательно поставьте бюджет-уведомление в разделе *Billing → Budgets*.

## Шаг 3. Открыть порты 80 и 443

В Oracle порты закрыты на двух уровнях.

**В облаке:** *Networking → Virtual cloud networks → ваша VCN → Security Lists → Default Security List → Add Ingress Rules*:

| Source CIDR | IP Protocol | Destination port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

**На самой машине** (образ Ubuntu от Oracle блокирует входящие соединения в iptables). Подключитесь по SSH и выполните:

```bash
ssh -i ~/Downloads/ssh-key.key ubuntu@<PUBLIC_IP>

sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

На Windows команда `ssh` работает в PowerShell. Если ругается на права ключа: ПКМ по файлу → Свойства → Безопасность → оставить доступ только своему пользователю.

## Шаг 4. Домен (бесплатно) — нужен для HTTPS

Кошельки и буфер обмена в браузере требуют HTTPS, поэтому нужен домен. Бесплатный поддомен:

1. Зайдите на [duckdns.org](https://www.duckdns.org) через Google или GitHub.
2. Создайте поддомен, например `mypay` → получится `mypay.duckdns.org`.
3. В поле *current ip* впишите Public IP сервера → *update ip*.

Если у вас есть свой домен — создайте A-запись на IP сервера. Caddy сам получит сертификат Let's Encrypt при первом запуске.

## Шаг 5. Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit   # перезайдите по SSH, чтобы группа применилась
```

Проверка: `docker compose version`.

## Шаг 6. Загрузить проект

Вариант А — с компьютера архивом:

```bash
# на своём компьютере
scp -i ~/Downloads/ssh-key.key cryptopay.zip ubuntu@<PUBLIC_IP>:~
# на сервере
sudo apt-get install -y unzip && unzip cryptopay.zip && cd cryptopay
```

Вариант Б — через GitHub: залейте проект в свой репозиторий и выполните `git clone https://github.com/<вы>/cryptopay.git && cd cryptopay`.

## Шаг 7. Настройки

```bash
cp .env.example .env
nano .env
```

Минимум, что нужно поменять:

```ini
DOMAIN=mypay.duckdns.org
PUBLIC_URL=https://mypay.duckdns.org
POSTGRES_PASSWORD=<вывод команды: openssl rand -hex 24>
REOWN_PROJECT_ID=<id с dashboard.reown.com>
```

**Где взять `REOWN_PROJECT_ID`:** [dashboard.reown.com](https://dashboard.reown.com) → *Create project* → тип *AppKit* → скопируйте *Project ID*. В настройках проекта добавьте ваш домен в *Allowed domains*. Без этого id работают только кошельки-расширения в браузере. С ним появляются QR-код, мобильные Trust Wallet, MetaMask и Phantom и полный список кошельков.

**RPC (желательно):** публичные RPC работают, но ограничивают число запросов. Бесплатный ключ [Alchemy](https://dashboard.alchemy.com) надёжнее:

```ini
RPC_URL_84532=https://base-sepolia.g.alchemy.com/v2/<ключ>
RPC_URL_11155111=https://eth-sepolia.g.alchemy.com/v2/<ключ>
```

## Шаг 8. Запуск

```bash
docker compose up -d --build
docker compose ps          # все три сервиса должны быть Up / healthy
docker compose logs -f api # должно быть "api listening" и "worker started"
```

Первая сборка занимает 3–6 минут. Откройте `https://mypay.duckdns.org` — увидите страницу «Принимайте USDC напрямую на свой кошелёк».

## Шаг 9. Первый магазин и закрытие регистрации

1. Откройте магазин на главной странице и **сохраните API-ключ**.
2. Закройте регистрацию для посторонних: в `.env` поставьте `ALLOW_REGISTRATION=false` и выполните `docker compose up -d`.
3. Проверьте оплату в тестовой сети — см. раздел «Как проверить оплату» в [README](../README.md#как-проверить-оплату-в-тестовой-сети).

---

## Обслуживание

| Задача | Команда |
|---|---|
| Логи | `docker compose logs -f api` |
| Обновить код | загрузить новую версию, затем `docker compose up -d --build` |
| Перезапуск | `docker compose restart api` |
| Резервная копия БД | `docker compose exec -T db pg_dump -U cryptopay cryptopay \| gzip > backup-$(date +%F).sql.gz` |
| Восстановление | `gunzip -c backup.sql.gz \| docker compose exec -T db psql -U cryptopay cryptopay` |
| Ежедневный бэкап | `crontab -e` → `0 3 * * * cd ~/cryptopay && docker compose exec -T db pg_dump -U cryptopay cryptopay \| gzip > ~/backup-$(date +\%F).sql.gz` |

## Если что-то не работает

| Симптом | Причина и решение |
|---|---|
| Сайт не открывается | Не открыты порты (шаг 3) или DNS ещё не обновился: `ping mypay.duckdns.org` должен показать IP сервера. |
| Ошибка сертификата | Caddy получает сертификат только когда домен уже указывает на сервер и порт 80 открыт. Смотрите `docker compose logs web`. |
| Тест без домена | В `.env`: `DOMAIN=:80`, `PUBLIC_URL=http://<IP>`. Сайт откроется по HTTP, но копирование в буфер и часть кошельков работать не будут. |
| «Сервис временно недоступен» | Не стартовал API: `docker compose logs api`. Частая причина — опечатка в `.env`. Сервер пишет, какая переменная неверна. |
| Платёж не находится | Посмотрите логи API на `job failed`. Обычно это лимит публичного RPC — задайте `RPC_URL_<id>` от Alchemy. |
| Сборка падает с нехваткой памяти | На машине с 1 ГБ RAM добавьте swap: `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`. |

## Перед приёмом настоящих денег

- Переключите сети на основные: `CHAINS=8453,1` (Base и Ethereum). Это реальные USDC.
- Задайте собственные RPC (`RPC_URL_8453`, `RPC_URL_1`) и, при желании, больше подтверждений (`CONFIRMATIONS_1=12`).
- Регистрация закрыта (`ALLOW_REGISTRATION=false`), бэкапы настроены.
- Адрес выплат — кошелёк, к которому у вас есть seed-фраза, лучше аппаратный.
- Уточните юридическую сторону. Во многих странах, включая Кыргызстан, приём платежей в криптовалюте для бизнеса регулируется законодательством о виртуальных активах.

## Источники

- [State of Free Hosting 2026 — SnapDeploy](https://snapdeploy.dev/state-of-free-hosting)
- [Free cloud deployment platforms 2026 comparison — SnapDeploy](https://snapdeploy.dev/blog/free-cloud-deployment-platforms-2026-comparison)
- [Best Free Tiers for Developers in 2026 — DEV Community](https://dev.to/pickuma/best-free-tiers-for-developers-in-2026-saas-paas-iaas-tools-54og)
- [Free API Hosting: 7 Options and Their Real Limits](https://publicapis.dev/blog/free-api-hosting)
