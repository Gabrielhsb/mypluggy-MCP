# Segurança / Security

Este projeto lida com dados bancários. Se encontrar uma vulnerabilidade, **não abra uma issue pública**: use o [reporte privado de vulnerabilidades do GitHub](https://github.com/Gabrielhsb/mypluggy-MCP/security/advisories/new).

This project handles bank data. If you find a vulnerability, **do not open a public issue**. Use [GitHub private vulnerability reporting](https://github.com/Gabrielhsb/mypluggy-MCP/security/advisories/new) instead.

## Boas práticas para quem hospeda / Self-hosting checklist

- Nunca publique o `.env` nem o volume `/data` (contém o segredo dos tokens e as passkeys). / Never publish `.env` or the `/data` volume (token secret and passkeys).
- Use um `SETUP_TOKEN` longo e aleatório (`openssl rand -base64 32`). / Use a long random `SETUP_TOKEN`.
- Mantenha abertas só as portas 22, 80 e 443. / Keep only ports 22, 80 and 443 open.
- Atualize a imagem com frequência (`git pull && docker compose up -d --build`). / Rebuild regularly.
