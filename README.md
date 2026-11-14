# IA Arena
Uma IA pequena (rede neural evoluída por tentativa e erro) joga Game Boy / Game Boy Color e treina sozinha. Várias janelas ao mesmo tempo.
Emulador: binjgb (MIT, Ben Smith) — ver LICENSE-binjgb.txt.

## Testar no navegador do celular
Hospede esta pasta em HTTPS (ex.: GitHub Pages) e abra no Chrome > menu > "Instalar app". Funciona offline depois.

## Gerar o APK (sem instalar nada)
1. Crie um repositório no GitHub e envie o conteúdo desta pasta.
2. Aba Actions > "Gerar APK" > Run workflow. Baixe `ia-arena-apk` (app-debug.apk) e instale.
(Ou, no PC: `npm install`, copie os arquivos web para `www/`, `npx cap add android`, abra `android/` no Android Studio.)

## Uso
Arena > Adicionar agente > escolha o arquivo da ROM (que você possui). Visual: 1 quadro a cada N s por janela. Offline: sem desenhar nada. "Ao vivo": melhor IA em 60 fps, com botão de som.
O endereço de RAM é opcional: sem ele, a recompensa é "alcançar telas diferentes".
