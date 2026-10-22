# myPluggy MCP

**Português** · [English](README.en.md)

Servidor [MCP](https://modelcontextprotocol.io) remoto e **somente leitura** que conecta o [Claude](https://claude.ai) às suas contas bancárias via [Pluggy](https://pluggy.ai) (Open Finance Brasil). Você hospeda no seu servidor, conecta no claude.ai como conector personalizado e pergunta coisas como:

> "Quanto gastei com restaurante em setembro?"
> "Qual o vencimento e o mínimo da fatura do cartão?"
> "Liste as transações acima de R$ 500 deste mês."

> [!IMPORTANT]
> Projeto pessoal e não oficial, sem vínculo com a Pluggy ou com a Anthropic. Cada pessoa hospeda a sua própria instância com as suas credenciais; nenhum dado passa por terceiros além do Pluggy e do Claude.

## Como funciona

```
claude.ai ──HTTPS + OAuth 2.1──▶ Caddy/nginx ──▶ myPluggy MCP ──API──▶ Pluggy ──Open Finance──▶ seus bancos
                                                  (Docker)
```

- **Transporte:** Streamable HTTP (`POST /mcp`), sem estado entre requisições.
- **Autenticação:** OAuth 2.1 com PKCE e registro dinâmico de cliente, o que o claude.ai espera de um conector personalizado. Para aprovar o acesso você usa uma **passkey** (Face ID, Touch ID, Windows Hello ou chave física). Não existe senha.
- **Somente leitura:** nenhuma tool escreve, paga ou movimenta dinheiro.

## Tools

| Tool | O que faz | Parâmetros |
|---|---|---|
| `listar_contas` | Contas e cartões com saldo atual, limite e datas da fatura | — |
| `listar_transacoes` | Transações do período, da mais recente à mais antiga (negativo = saída) | `de`, `ate` (YYYY-MM-DD), `conta_id?`, `limite?` |
| `resumo_por_categoria` | Gastos agrupados por categoria, com percentual | `de`, `ate`, `conta_id?` |
| `listar_faturas_cartao` | Fatura aberta (fechamento, vencimento, mínimo) e últimas faturas fechadas | `conta_id?`, `quantidade?` |
| `listar_investimentos` | Posição de investimentos, quando o banco disponibiliza | — |

O resumo por categoria ignora transferências entre contas próprias, pagamento de fatura e aplicações/resgates, para não contar o mesmo dinheiro duas vezes.

## Pré-requisitos

- Conta no [Pluggy](https://dashboard.pluggy.ai) com uma aplicação criada (fornece `CLIENT_ID` e `CLIENT_SECRET`).
- Bancos conectados pelo **[Meu Pluggy](https://meu.pluggy.ai)**, o caminho do Pluggy para uso pessoal: gratuito, sem uso comercial, com limite de conexões. Veja o [guia oficial](https://docs.pluggy.ai/en/docs/guides/meu-pluggy-personal-use).
- Um servidor Linux com Docker e Docker Compose, acessível pela internet nas portas 80 e 443.
- Um domínio ou subdomínio apontando para o servidor. Sem domínio, dá para usar o [sslip.io](https://sslip.io): `mcp.203-0-113-10.sslip.io` resolve para `203.0.113.10` (troque pelo IP do seu servidor).

## Passo a passo

### 1. Pluggy

1. Em [meu.pluggy.ai](https://meu.pluggy.ai), crie a conta e conecte seus bancos.
2. Entre no [Dashboard do Pluggy](https://dashboard.pluggy.ai) com a mesma conta, abra *Applications → sua aplicação* e copie o **Client ID** e o **Client Secret**.
3. Na aba *Demo*, clique em **Connect Account** e, no widget, escolha o conector **MeuPluggy** (não o banco, nem o Sandbox). Cada banco do Meu Pluggy vira um **item** da aplicação.
4. Copie os IDs dos itens em *Demo → Connected Items*. A API do Pluggy não lista itens para aplicações comuns, então os IDs precisam ir na configuração.

### 2. Configuração

No servidor:

```bash
git clone https://github.com/Gabrielhsb/mypluggy-MCP.git
cd mypluggy-MCP
cp .env.example .env
openssl rand -base64 32   # use a saída como SETUP_TOKEN
nano .env                 # preencha as variáveis
```

| Variável | Descrição |
|---|---|
| `PLUGGY_CLIENT_ID` / `PLUGGY_CLIENT_SECRET` | Credenciais da aplicação no Pluggy |
| `PLUGGY_ITEM_IDS` | IDs dos itens, separados por vírgula |
| `PUBLIC_URL` | URL pública, ex.: `https://mcp.seudominio.com` |
| `SETUP_TOKEN` | Segredo usado só para cadastrar a primeira passkey (mínimo de 24 caracteres) |
| `MCP_DOMAIN` | Domínio para o Caddy emitir o certificado (só com a opção A) |

Confira se as credenciais e os itens funcionam. O diagnóstico imprime só contagens e nomes de campos, nunca valores:

```bash
docker compose run --rm mcp node dist/doctor.js
```

### 3. Subir o servidor

**Opção A, servidor limpo (Caddy com HTTPS automático):**

```bash
docker compose --profile caddy up -d --build
```

**Opção B, servidor que já usa nginx nas portas 80/443:**

```bash
docker compose up -d --build   # MCP fica só em 127.0.0.1:3000
```

Depois configure o site do nginx a partir de [`deploy/nginx.conf.example`](deploy/nginx.conf.example) e gere o certificado com `certbot --nginx`. Se a porta 3000 estiver ocupada, defina `MCP_HOST_PORT` no `.env` e ajuste o `proxy_pass`.

**Firewall:** deixe abertas só as portas 22, 80 e 443.

```bash
sudo ufw allow 22,80,443/tcp && sudo ufw enable
```

Em nuvens como Oracle, AWS e GCP, libere as mesmas portas também na regra de rede da instância (security list ou security group).

Teste: `https://mcp.seudominio.com/health` deve responder `{"ok":true}`.

### 4. Conectar no claude.ai

1. Em **Settings → Connectors**, clique em **Add custom connector**.
2. Em URL, informe `https://mcp.seudominio.com/mcp`.
3. Clique em **Connect**. Abre a página de autorização do seu servidor:
   - **Primeiro acesso:** informe o `SETUP_TOKEN` e registre sua passkey.
   - **Depois:** só confirme com a passkey.
4. Pronto. As tools aparecem no menu de ferramentas da conversa.

## Segurança

- Credenciais do Pluggy ficam só no `.env`, que está no `.gitignore` e no `.dockerignore`.
- Access token dura 1 hora e refresh token 30 dias, os dois assinados com HMAC. Para revogar todos, apague `tokenSecret` de `/data/state.json` (volume `mcp-data`) e reinicie o container.
- Registrar passkey exige o `SETUP_TOKEN`. Após 5 erros em 15 minutos, novas tentativas são bloqueadas.
- Rate limit: 60 req/min no `/mcp`, 30 req/min nas rotas de passkey, além dos limites do SDK nas rotas OAuth.
- Os logs registram só método, rota, status, duração e nome da tool. Query string, tokens e dados bancários não entram.
- A página de autorização usa CSP restritiva, `X-Frame-Options: DENY` e `no-store`.
- O container roda como usuário sem privilégios e só fica exposto em `127.0.0.1`. Quem fala com a internet é o proxy.

Encontrou uma vulnerabilidade? Veja [SECURITY.md](SECURITY.md).

## Limitações

- O Pluggy não entrega o valor da **fatura aberta**, só as datas e o mínimo. As faturas fechadas vêm completas. Para o parcial, peça ao Claude para somar as transações do cartão desde o último fechamento.
- Itens do Meu Pluggy são atualizados pelo Pluggy cerca de uma vez por dia.
- Um único dono por instância: a passkey dá acesso a todos os itens configurados.

## Desenvolvimento

Requer Node.js 20.6 ou superior.

```bash
npm install
cp .env.example .env   # PUBLIC_URL=http://localhost:3000 (passkey funciona em localhost)
npm run doctor         # valida credenciais e itens
npm run dev            # servidor com reload
npm test               # testes
npm run lint           # ESLint + checagem de tipos
npm run build          # compila para dist/
```

Para testar sem o claude.ai, use o [MCP Inspector](https://github.com/modelcontextprotocol/inspector) apontando para `http://localhost:3000/mcp`.

## Licença

[MIT](LICENSE)
