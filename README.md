# Scripts Violentmonkey

Userscripts para o [Violentmonkey](https://violentmonkey.github.io/) que melhoram o YouTube, o Instagram e o Futemax no navegador.
Testados no Google Chrome com Violentmonkey.

| Script | O que faz | Instalar |
| --- | --- | --- |
| **YouTube – data e hora exatas nos cards** | Troca o "Transmitido há 2 anos" por início → fim exatos da live, ou data/hora de publicação do vídeo | [instalar](https://raw.githubusercontent.com/danilolsilva/scripts-violentmonkey/main/youtube-data-hora.user.js) |
| **YouTube: desativar atalho "/"** | Impede que a tecla "/" jogue o foco para a pesquisa do YouTube | [instalar](https://raw.githubusercontent.com/danilolsilva/scripts-violentmonkey/main/youtube-desativar-atalho-pesquisa.user.js) |
| **Instagram – barra de progresso nos vídeos** | Barra clicável e arrastável nos vídeos, com tempo atual e duração | [instalar](https://raw.githubusercontent.com/danilolsilva/scripts-violentmonkey/main/instagram-barra-progresso.user.js) |
| **Instagram – data e hora exatas nas postagens** | Acrescenta a data e hora exatas ao "3 h", "2 sem." etc., inclusive na aba Reels | [instalar](https://raw.githubusercontent.com/danilolsilva/scripts-violentmonkey/main/instagram-data-hora.user.js) |
| **Futemax – sem pop-ups e abas novas** | Bloqueia pop-unders e abas novas e roda os players em sandbox | [instalar](https://raw.githubusercontent.com/danilolsilva/scripts-violentmonkey/main/futemax-antipopup.user.js) |

## Como instalar

1. Instale a extensão [Violentmonkey](https://violentmonkey.github.io/get-it/).
2. Clique em **instalar** na tabela acima. O Violentmonkey abre a tela de instalação; confirme.
3. Recarregue o site.

Os scripts têm `@updateURL`, então o Violentmonkey busca as novas versões deste repositório sozinho.
Se você já tinha instalado um deles colando o código, instalar pelo link acima substitui o antigo (mesmo nome e namespace) e passa a receber atualizações.

Todos os horários aparecem no fuso horário do seu computador.

---

## YouTube – data e hora exatas nos cards

Arquivo: [`youtube-data-hora.user.js`](youtube-data-hora.user.js)

Acrescenta uma linha embaixo de "▷ 92 · Transmitido há 2 anos" em cada card de vídeo:

| Tipo de vídeo | Exemplo |
| --- | --- |
| Live encerrada | `05/11/2026 08:59 → 18:08` (início → fim; se passou da meia-noite, mostra a data do fim) |
| Ao vivo agora | `Ao vivo desde 22/10/2026 11:57` |
| Live agendada | `Agendada: 16/11/2026 16:05` |
| Vídeo comum | `05/11/2026 13:35` (publicação) |

Passando o mouse, aparecem o dia da semana e os segundos.

- **Onde funciona:** abas do canal (Vídeos, Ao vivo — inclusive alternando "Mais recentes / Mais antigos"), página inicial, barra lateral da página de vídeo e busca.
- **Como funciona:** os cards não trazem a hora exata, então o script consulta a mesma API interna que o player do YouTube usa (`/youtubei/v1/player`, ~10 KB por vídeo; nada é reproduzido). Só consulta os cards que estão na tela ou perto dela, até 4 por vez, e guarda o resultado no armazenamento do script para não consultar de novo.
- **Busca:** se outra extensão já estiver mostrando a data completa, o script não duplica.

## YouTube: desativar atalho "/"

Arquivo: [`youtube-desativar-atalho-pesquisa.user.js`](youtube-desativar-atalho-pesquisa.user.js)

No YouTube, apertar "/" joga o foco para a caixa de pesquisa. O script intercepta a tecla antes do YouTube e desativa esse atalho; os demais atalhos continuam funcionando.

## Instagram – barra de progresso nos vídeos

Arquivo: [`instagram-barra-progresso.user.js`](instagram-barra-progresso.user.js)

O Instagram esconde a barra de progresso no navegador. Este script coloca uma barra fina na base de cada vídeo:

- **Clique** para pular para um ponto; **arraste** para avançar/voltar.
- Com o mouse em cima, a barra engrossa e mostra o tempo atual / total e o tempo sob o cursor.
- A parte já carregada aparece num tom mais claro.
- Funciona no **feed**, nos **posts** (página e janela) e na aba **Reels**.
- A faixa clicável tem 12 px e fica abaixo do botão de som, que continua funcionando. O clique na barra não pausa, não curte e não abre o post.
- Lives (sem duração definida) ficam sem barra. Stories ainda não foram testados.

## Instagram – data e hora exatas nas postagens

Arquivo: [`instagram-data-hora.user.js`](instagram-data-hora.user.js)

O Instagram mostra datas vagas ("1 d" para um post de dois dias atrás, "4 sem", "15 de outubro") e a dica do mouse só traz o dia. Este script mantém o texto original e acrescenta a data e hora exatas:

- **Feed:** `perfil • 15 h · 16/11/2026 23:56`
- **Comentários:** `2 h · 17/11/2026 01:17`
- **Post aberto:** `há 2 dias · 15/11/2026 09:39`
- **Aba Reels:** uma linha embaixo do nome do autor, ex.: `2 sem · 03/11/2026 09:55`

Passando o mouse, aparecem o dia da semana e os segundos.

- **Feed, posts e comentários:** o horário exato já vem na página (atributo `datetime` do elemento `<time>`), então não há nenhuma consulta extra.
- **Reels:** lá a página não tem data. O script pega o código do reel na URL e consulta a API interna do Instagram (`/api/v1/media/{id}/info/`), 1 vez por reel, só quando o reel está parado na tela. Enquanto carrega, aparece "…".

## Futemax – sem pop-ups e abas novas

Arquivo: [`futemax-antipopup.user.js`](futemax-antipopup.user.js)

O site abre pop-unders e abas novas no primeiro clique, e os players (iframes de terceiros) carregam anúncios próprios. O script:

- Desativa o `window.open` e os cliques/formulários que abrem abas sem você pedir.
- Impede o carregamento dos scripts de rede de anúncio vistos no site e nos players.
- Roda cada player em iframe com **sandbox**, sem permissão para abrir abas, redirecionar a página, mostrar alertas ou baixar arquivos. Quem bloqueia é o próprio navegador.
- Marca com ⚠ as opções de player cujo player aninhado foi detectado pelo Windows Defender como malware (`Trojan:JS/Cryxos`). Dá para esconder essas opções trocando `riskyOptions` para `'hide'` no início do script.

O `@match` pega todos os sites porque o script precisa rodar dentro dos iframes dos players, que estão em domínios que mudam o tempo todo. Na primeira linha ele verifica se está no Futemax (ou num iframe embutido nele) e, se não estiver, não faz nada.

## Limitações

- As APIs usadas (YouTube `youtubei/v1/player` e Instagram `api/v1/media/…/info`) são internas e não oficiais. Se mudarem, a parte que depende delas para de funcionar (no Instagram, só a data dos Reels; o resto continua).
- O YouTube e o Instagram mudam o layout de vez em quando; se algo sumir, abra uma [issue](https://github.com/danilolsilva/scripts-violentmonkey/issues).

## Licença

[MIT](LICENSE)
