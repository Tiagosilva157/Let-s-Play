// Base de conhecimento do Let's Play — fonte única do manual.
// Renderizada em /admin/ajuda. Para atualizar o manual, edite aqui.

export type Block =
  | { type: "p"; text: string }
  | { type: "steps"; items: string[] }
  | { type: "list"; items: string[] }
  | { type: "fields"; items: { label: string; text: string }[] }
  | { type: "tip"; text: string }
  | { type: "warn"; text: string };

export interface ManualSection {
  id: string;
  icon: string;
  title: string;
  summary: string;
  blocks: Block[];
}

export const MANUAL: ManualSection[] = [
  {
    id: "visao-geral",
    icon: "🏐",
    title: "Como o Let's Play funciona",
    summary: "A ideia geral do sistema em dois minutos.",
    blocks: [
      {
        type: "p",
        text: "O Let's Play organiza os jogos que hoje são combinados na mão dentro do grupo do WhatsApp. Existem dois lados: o painel do administrador, que é privado e onde você controla tudo, e o link público, que é o endereço que você compartilha no grupo para os jogadores confirmarem presença sozinhos.",
      },
      {
        type: "p",
        text: "O jogador nunca precisa criar conta nem instalar nada. Ele abre o link, informa o WhatsApp, recebe um código de seis dígitos e pronto: em poucos segundos confirma que vai jogar, avisa que não vai, ou paga o Pix se for avulso.",
      },
      {
        type: "list",
        items: [
          "As listas abrem e fecham sozinhas, no dia e hora que você configurar.",
          "O sistema nunca deixa passar da capacidade da quadra, mesmo que duas pessoas peçam a última vaga no mesmo instante.",
          "A vaga do avulso só é confirmada depois que o Pix é pago de verdade.",
          "A lista atualizada é enviada automaticamente no grupo do WhatsApp.",
        ],
      },
      {
        type: "tip",
        text: "Ordem recomendada para começar: cadastre a turma, adicione os mensalistas, confira o link público e só depois compartilhe no grupo.",
      },
    ],
  },
  {
    id: "turmas",
    icon: "📅",
    title: "Turmas",
    summary: "Criar e configurar cada dia de vôlei.",
    blocks: [
      {
        type: "p",
        text: "Turma é cada grupo de jogo que se repete toda semana. Se você joga segunda, terça e quinta, são três turmas — cada uma com seu próprio horário, quadra, preço, mensalistas e grupo de WhatsApp.",
      },
      { type: "steps", items: [
        "Vá em Turmas e clique em Nova turma.",
        "Preencha o nome, o dia da semana, o horário e o endereço da quadra.",
        "Defina a capacidade e os valores da mensalidade e do avulso.",
        "Ajuste os prazos de abertura, confirmação e desistência.",
        "Cole o ID do grupo do WhatsApp, se já tiver.",
        "Salve. Os jogos das próximas semanas são criados automaticamente.",
      ]},
      { type: "fields", items: [
        { label: "Link público", text: "É o endereço da turma, com letras minúsculas e hífens. Por exemplo, digitando volei-segunda o link fica /j/volei-segunda. É esse link que vai no grupo." },
        { label: "Capacidade", text: "Total de jogadores em quadra, contando mensalistas e avulsos juntos. O sistema nunca ultrapassa esse número." },
        { label: "Abrir lista (horas antes)", text: "Quantas horas antes do jogo a lista abre. O padrão é 168, que equivale a uma semana antes." },
        { label: "Confirmar até (horas antes)", text: "Prazo final para entrar na lista. Depois disso a lista fecha e ninguém mais confirma sozinho." },
        { label: "Desistir até (horas antes)", text: "Até quando dá para desistir sem cobrança. Passou desse prazo, o valor do dia continua devido." },
        { label: "Envio de mensagens", text: "Como o sistema avisa o grupo. Veja a seção sobre WhatsApp para entender cada opção." },
      ]},
      {
        type: "tip",
        text: "Desativar uma turma para de gerar jogos novos, mas mantém todo o histórico. Use isso em vez de excluir quando a turma entra em férias.",
      },
    ],
  },
  {
    id: "mensalistas-avulsos",
    icon: "👥",
    title: "Mensalistas e avulsos",
    summary: "A diferença entre os dois tipos e como cadastrar.",
    blocks: [
      {
        type: "p",
        text: "Mensalista é o jogador fixo de uma turma: ele paga a mensalidade e tem a vaga guardada em todo jogo. Avulso é quem entra de vez em quando: só consegue vaga se houver espaço e paga por jogo, via Pix.",
      },
      {
        type: "p",
        text: "A diferença está no vínculo com a turma, não no cadastro da pessoa. A mesma pessoa pode ser mensalista da segunda e avulsa na quinta — o sistema entende isso naturalmente.",
      },
      {
        type: "p",
        text: "Mesmo tendo a vaga guardada, o mensalista precisa responder se vai ou não. Quando ele diz que não vai, a vaga é liberada na hora para os avulsos. É assim que o sistema evita quadra vazia com lista cheia.",
      },
      { type: "steps", items: [
        "Para cadastrar um mensalista, abra a turma e clique em Adicionar, ou vá em Jogadores, crie o jogador e marque a opção Mensalista escolhendo as turmas.",
        "Preencha nome, WhatsApp, CPF e e-mail — os dois últimos são obrigatórios para conseguir cobrar.",
        "Informe o valor da mensalidade e o dia do vencimento (o padrão é dia 10). Deixando o valor em branco, vale o valor da turma.",
        "Quando quiser começar a cobrar, clique em Cobrar mensalidade ao lado do nome dele dentro da turma.",
      ]},
      {
        type: "warn",
        text: "Só é possível marcar alguém como mensalista se já existir pelo menos uma turma cadastrada. É a turma que define o valor e o grupo do jogador.",
      },
      {
        type: "tip",
        text: "O avulso não precisa ser cadastrado por você. Ele mesmo se cadastra quando entra pelo link público pela primeira vez.",
      },
    ],
  },
  {
    id: "jogos",
    icon: "🗓️",
    title: "Jogos e listas",
    summary: "O dia a dia: abrir, acompanhar, ajustar e cancelar.",
    blocks: [
      {
        type: "p",
        text: "Os jogos das próximas semanas são criados automaticamente a partir da configuração da turma. Você não precisa cadastrar jogo por jogo — só entra na tela do jogo quando quiser acompanhar ou ajustar alguma coisa.",
      },
      { type: "fields", items: [
        { label: "Agendado", text: "O jogo existe, mas a lista ainda não abriu. Ninguém consegue confirmar." },
        { label: "Lista aberta", text: "Os jogadores estão confirmando pelo link público." },
        { label: "Lista fechada", text: "O prazo acabou. Só você consegue mexer na lista." },
        { label: "Cancelado", text: "O jogo não vai acontecer. Quem pagou fica pendente de decisão sua." },
      ]},
      {
        type: "p",
        text: "Dentro do jogo você vê os confirmados, os mensalistas que ainda não responderam, quem está aguardando Pix e a lista de espera. Também pode confirmar ou remover alguém na mão — útil quando o jogador paga em dinheiro na quadra.",
      },
      { type: "list", items: [
        "Abrir lista agora: adianta a abertura sem esperar o horário programado — e já anuncia no grupo com data, local, vagas e o link.",
        "Fechar lista: encerra as confirmações antes do prazo.",
        "Enviar lista ao grupo: manda a lista atualizada no WhatsApp na hora.",
        "Cancelar jogo: encerra a partida e avisa o grupo automaticamente.",
      ]},
      {
        type: "tip",
        text: "Toda alteração feita por você fica registrada no histórico do sistema, com data e autor. Nada se perde.",
      },
    ],
  },
  {
    id: "link-publico",
    icon: "🔗",
    title: "O link público",
    summary: "O que o jogador vê e como ele confirma presença.",
    blocks: [
      {
        type: "p",
        text: "Cada turma tem um link fixo, no formato /j/nome-da-turma. Esse é o link que fica fixado no grupo do WhatsApp: ele sempre mostra o próximo jogo, então não precisa trocar toda semana.",
      },
      { type: "steps", items: [
        "O jogador abre o link e vê a data, o horário, a quadra e quantas vagas restam.",
        "Ele informa o número do WhatsApp e recebe um código de seis dígitos por mensagem.",
        "Digitando o código, ele entra. Se for a primeira vez, informa o nome.",
        "Mensalista escolhe entre Vou jogar e Não vou este dia.",
        "Avulso clica em Participar e, na primeira vez, informa CPF e e-mail (exigência do banco para emitir o Pix).",
        "O QR Code aparece na tela e o código copia e cola chega no WhatsApp dele. São 15 minutos para pagar.",
        "Assim que o pagamento cai, a vaga é confirmada sozinha, o jogador é avisado e a lista do grupo é atualizada.",
      ]},
      {
        type: "p",
        text: "O código por WhatsApp existe para impedir que uma pessoa mexa na participação de outra só sabendo o número dela. Depois de entrar, o jogador fica conectado por 30 dias naquele aparelho, então não precisa repetir o código toda semana.",
      },
      {
        type: "tip",
        text: "A lista de confirmados aparece no link com o primeiro nome e a inicial do sobrenome. Telefones nunca ficam visíveis para os outros jogadores.",
      },
    ],
  },
  {
    id: "pagamentos",
    icon: "💳",
    title: "Pagamentos",
    summary: "Pix dos avulsos, mensalidades e o painel financeiro.",
    blocks: [
      {
        type: "p",
        text: "Os pagamentos passam pelo Asaas. Quando alguém paga, o Asaas avisa o sistema na hora e a vaga é confirmada sozinha — você não precisa conferir extrato nem confirmar nada manualmente.",
      },
      {
        type: "warn",
        text: "Todo jogador precisa ter CPF e e-mail no cadastro. O banco não emite nenhuma cobrança sem CPF, e o e-mail é o que permite o envio automático dos avisos de vencimento. Na tela de Jogadores, quem está sem CPF aparece com a marca “Sem CPF”.",
      },
      {
        type: "p",
        text: "No avulso funciona assim: ao pedir a vaga, o sistema pede o CPF e o e-mail dele (só na primeira vez) e reserva a vaga por 15 minutos enquanto o Pix é gerado. Se pagar, vira confirmado. Se não pagar nesse tempo, a reserva cai, a cobrança é cancelada e a vaga volta para quem estiver esperando.",
      },
      {
        type: "p",
        text: "Além de aparecer na tela, o Pix é enviado no WhatsApp do jogador em duas mensagens: uma com as instruções e o valor, e outra contendo apenas o código copia e cola, para ele conseguir copiar sem sobrar nada junto. Quando o pagamento cai, ele recebe também a confirmação de que a vaga está garantida.",
      },
      {
        type: "p",
        text: "Na mensalidade, você clica em Cobrar mensalidade uma única vez e o Asaas passa a gerar a cobrança todo mês no dia do vencimento. O status aparece no painel como Em dia ou Inadimplente, atualizado sozinho.",
      },
      { type: "fields", items: [
        { label: "Pendente", text: "Cobrança criada, aguardando pagamento." },
        { label: "Recebido ou Confirmado", text: "Pagamento caiu. Vaga garantida." },
        { label: "Vencido", text: "Passou do prazo sem pagar." },
        { label: "Expirado", text: "O avulso não pagou nos 15 minutos e a vaga foi liberada." },
        { label: "Estornado", text: "Você devolveu o valor pelo painel." },
      ]},
      {
        type: "warn",
        text: "Enquanto o ambiente estiver em Sandbox, nenhum dinheiro é movimentado de verdade — é o modo de testes. Para cobrar para valer, vá em Configurações, troque para Produção e cole a chave de produção do Asaas.",
      },
    ],
  },
  {
    id: "whatsapp",
    icon: "💬",
    title: "Mensagens no WhatsApp",
    summary: "Como o grupo é avisado e como controlar o volume.",
    blocks: [
      {
        type: "p",
        text: "Todas as mensagens do sistema saem pelo WhatsApp: as do grupo e também as individuais. Cada turma tem seu próprio grupo vinculado.",
      },
      { type: "list", items: [
        "No grupo: quando a lista abre, quando alguém confirma ou desiste, quando um avulso paga, quando a lista enche e quando o jogo é cancelado.",
        "No particular do jogador: o código de acesso ao link, o Pix do avulso e a confirmação de que o pagamento caiu.",
      ]},
      {
        type: "p",
        text: "Para vincular, você precisa do ID do grupo, que tem o formato de um número longo terminado em @g.us. Ele é colado no campo do grupo dentro da configuração da turma. O sistema recusa formatos diferentes desse para evitar mensagens perdidas.",
      },
      { type: "fields", items: [
        { label: "A cada alteração", text: "Manda mensagem sempre que algo muda. Fica atualizado ao extremo, mas pode gerar bastante mensagem em dia movimentado." },
        { label: "Agrupado", text: "O recomendado. O sistema espera alguns minutos juntando as mudanças e manda uma única lista atualizada. Se chegar outra alteração nesse meio tempo, a mensagem pendente é substituída pela versão mais nova." },
        { label: "Somente manual", text: "O sistema não envia nada sozinho. Você clica em Enviar lista ao grupo quando quiser." },
      ]},
      {
        type: "tip",
        text: "Se uma mensagem falhar, o sistema tenta de novo automaticamente e mostra um aviso na tela inicial caso não consiga. A lista nunca fica errada por causa de uma mensagem que não saiu.",
      },
    ],
  },
  {
    id: "situacoes",
    icon: "🧩",
    title: "Situações do dia a dia",
    summary: "O que fazer quando algo foge do normal.",
    blocks: [
      { type: "fields", items: [
        { label: "Duas pessoas pediram a última vaga junto", text: "O sistema resolve sozinho: uma entra e a outra recebe o aviso de lista cheia, com opção de entrar na espera. Não existe vaga duplicada." },
        { label: "O avulso pagou, mas a lista já tinha enchido", text: "A participação dele aparece marcada como Pagou sem vaga na tela do jogo, com os botões Crédito e Estornar para você decidir." },
        { label: "Alguém desistiu e liberou vaga", text: "O primeiro da lista de espera é promovido automaticamente e a lista do grupo é atualizada." },
        { label: "O jogo foi cancelado depois de gente pagar", text: "Cancele pelo painel: o grupo é avisado e todos os avulsos pagos ficam pendentes para você dar crédito ou estornar." },
        { label: "O jogador trocou de telefone", text: "Edite o número em Jogadores. As sessões antigas são derrubadas na hora, por segurança." },
        { label: "Alguém desistiu fora do prazo", text: "O sistema bloqueia a desistência e mantém a cobrança. Se quiser abrir exceção, remova a pessoa manualmente pela tela do jogo." },
        { label: "Um mensalista não respondeu", text: "Ele fica como Aguardando resposta segurando a vaga. Você pode confirmá-lo ou removê-lo manualmente antes do jogo." },
        { label: "Preciso tirar alguém da lista", text: "Na tela do jogo, clique em Remover ao lado do nome. A vaga é liberada e a lista de espera é promovida." },
      ]},
    ],
  },
  {
    id: "administradores",
    icon: "🔐",
    title: "Administradores e acesso",
    summary: "Quem pode entrar no painel e com quais poderes.",
    blocks: [
      {
        type: "p",
        text: "Existem dois níveis. O administrador Principal é o dono do sistema: só ele cria e remove outros administradores e mexe nas integrações. Os demais administradores cuidam do dia a dia — turmas, jogos, jogadores e financeiro.",
      },
      { type: "steps", items: [
        "Vá em Administradores e clique em Novo administrador.",
        "Informe nome, e-mail e uma senha de pelo menos oito caracteres.",
        "Entregue esses dados para a pessoa. Ela entra pela mesma tela de login.",
      ]},
      {
        type: "tip",
        text: "Cada administrador pode trocar a própria senha pela tela de Administradores. O Principal pode trocar a senha de qualquer um. Para encerrar a sessão, use o botão Sair no canto superior direito do painel.",
      },
      {
        type: "warn",
        text: "O administrador Principal não pode ser removido nem remover a si mesmo — é a proteção contra ficar sem acesso ao sistema.",
      },
    ],
  },
  {
    id: "configuracoes",
    icon: "⚙️",
    title: "Configurações e integrações",
    summary: "Chaves do Asaas e do WhatsApp, e como testá-las.",
    blocks: [
      {
        type: "p",
        text: "Na tela de Configurações ficam as chaves do Asaas e do GP Connect. Elas aparecem sempre mascaradas e nunca chegam ao navegador dos jogadores: ficam guardadas apenas no servidor.",
      },
      {
        type: "p",
        text: "Deixar um campo em branco mantém o valor que já está salvo. Você só digita quando quiser substituir.",
      },
      { type: "steps", items: [
        "Para trocar a chave do Asaas, cole a nova no campo Chave de API e salve.",
        "Escolha o ambiente: Sandbox para testes ou Produção para cobrar de verdade.",
        "Clique em Testar conexão com o Asaas para confirmar que a chave está válida.",
        "Para o WhatsApp, cole o token do GP Connect e use o teste de mensagem informando seu próprio número.",
      ]},
      {
        type: "warn",
        text: "Atenção ao colar: os campos ficam ocultos por segurança, então um texto digitado por engano passa despercebido. Sempre confirme com os botões de teste depois de salvar.",
      },
      {
        type: "warn",
        text: "Ao trocar para Produção, o webhook do Asaas precisa ser registrado novamente no ambiente novo. Avise o responsável técnico nessa hora.",
      },
    ],
  },
  {
    id: "problemas",
    icon: "🛟",
    title: "Resolvendo problemas",
    summary: "As dúvidas mais comuns e o que verificar primeiro.",
    blocks: [
      { type: "fields", items: [
        { label: "O jogador não recebeu o código", text: "Confira se o número está com DDD e se o token do GP Connect está válido em Configurações, usando o teste de mensagem." },
        { label: "A lista não chegou no grupo", text: "Verifique se o ID do grupo está no formato 1203...@g.us, se o modo de envio não está em Somente manual e se o token do WhatsApp está correto em Configurações. Avisos de falha aparecem na tela inicial." },
        { label: "O Pix não confirmou a vaga", text: "Veja em Financeiro se a cobrança consta como paga. O sistema também confere sozinho de tempos em tempos e corrige diferenças." },
        { label: "O jogador não recebeu o Pix no WhatsApp", text: "Confira se o número dele está com DDD e se o token do WhatsApp está válido em Configurações. O QR Code continua disponível na tela do link público mesmo se a mensagem falhar." },
        { label: "O código Pix veio quebrado", text: "O código é enviado sozinho, em uma mensagem separada, justamente para poder ser copiado inteiro. Oriente o jogador a segurar essa mensagem e escolher Copiar — não selecionar o texto com o dedo." },
        { label: "Não consigo marcar alguém como mensalista", text: "Cadastre uma turma primeiro. Mensalista sempre pertence a uma turma." },
        { label: "A cobrança não foi criada", text: "O banco exige CPF e e-mail do jogador para emitir qualquer cobrança. Abra o cadastro do jogador e preencha esses campos — quem estiver sem CPF aparece marcado na lista de Jogadores." },
        { label: "A lista fechou antes da hora", text: "Revise o campo Confirmar até nas configurações da turma. Ele conta horas antes do jogo." },
        { label: "Reabri a lista e ela fechou sozinha", text: "Ao reabrir uma lista com o prazo vencido, o sistema estende o prazo até o horário do jogo automaticamente, então ela permanece aberta." },
        { label: "Um jogo não foi criado", text: "Confirme se a turma está Ativa e se o dia da semana está correto. Os jogos são gerados para as próximas semanas, uma vez por dia." },
      ]},
    ],
  },
];
