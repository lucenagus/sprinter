// Offline emoji suggestions from what the user is typing. Understands English
// and Portuguese keywords, accents optional, and matches words still being typed.

export const DEFAULT_EMOJI = ['✨', '🎯', '📌', '✅', '⭐️', '🔥'];

const TABLE = [
  ['🏃', 'run running jog corrida correr 5k 10k 21k marathon maratona cardio'],
  ['🏋️', 'gym workout lift academia treino treinar musculação weights crossfit'],
  ['🧘', 'yoga meditate meditation meditar meditação mindful breathe respirar pilates alongar stretch'],
  ['🚴', 'bike cycling ride pedalar bicicleta spinning'],
  ['🏊', 'swim swimming nadar natação pool piscina'],
  ['⚽️', 'soccer football futebol pelada futsal'],
  ['🎾', 'tennis padel beach'],
  ['🚶', 'walk caminhar caminhada steps passos hike trilha'],
  ['🥗', 'diet salad healthy dieta salada saudável eat comer nutri nutricionista'],
  ['🍳', 'cook cooking breakfast cozinhar receita recipe meal marmita'],
  ['🛒', 'grocery groceries shopping mercado compras supermercado buy comprar feira'],
  ['💧', 'water hydrate água beber'],
  ['☕️', 'coffee café cafe'],
  ['😴', 'sleep nap dormir sono rest descansar descanso'],
  ['🛏️', 'bed cama wake acordar early cedo morning manhã routine rotina'],
  ['📚', 'read reading book books ler leitura livro livros study estudar estudo'],
  ['✍️', 'write writing escrever texto journal diário essay blog artigo article'],
  ['🎓', 'course class aula curso exam prova faculdade college school escola homework tcc mestrado thesis'],
  ['🗣️', 'english inglês language idioma spanish espanhol italian italiano french francês duolingo'],
  ['💻', 'code coding program programar app website site dev deploy bug swift frontend'],
  ['🎨', 'design draw drawing paint desenhar desenho pintar art arte illustration ilustração logo brand branding figma poster cartaz'],
  ['📸', 'photo photos foto fotos shoot camera câmera ensaio fotografia'],
  ['🎬', 'video vídeo film filme movie editar edit motion youtube reel reels animação animation'],
  ['🎵', 'music música song piano playlist spotify cantar sing'],
  ['🎸', 'guitar guitarra violão band banda baixo'],
  ['🎙️', 'podcast record gravar voice mic episode episódio'],
  ['💼', 'work trabalho job emprego client cliente office escritório career carreira vaga interview entrevista'],
  ['🤝', 'meeting reunião network networking friends amigos amigo amiga meet encontro encontrar visit visitar partnership parceria'],
  ['📊', 'report relatório data dados spreadsheet planilha excel metrics métricas analysis análise dashboard'],
  ['📈', 'invest investir investimento stocks ações growth crescer sales vendas'],
  ['🧾', 'tax taxes imposto impostos irpf invoice nota receipt boleto bill contador accountant'],
  ['💰', 'money dinheiro save economizar poupar budget orçamento salary salário pay pagar finance finanças reserva'],
  ['💳', 'card cartão credit fatura bank banco pix'],
  ['📧', 'email emails inbox mail'],
  ['📞', 'call ligar ligação phone telefone telefonar'],
  ['💬', 'message mensagem whatsapp reply responder chat conversar conversa'],
  ['📅', 'schedule agenda calendar calendário plan planejar planning planejamento appointment marcar agendar'],
  ['🩺', 'doctor médico medico checkup exame exams consulta hospital clinic clínica health saúde'],
  ['🦷', 'dentist dentista teeth dente dentes'],
  ['💊', 'medicine remédio pill vitamina vitamin pharmacy farmácia'],
  ['🧠', 'therapy terapia psychologist psicólogo psicóloga mental learn aprender'],
  ['💇', 'haircut cabelo barber barbeiro barba salão salon'],
  ['🧴', 'skincare pele skin cream creme'],
  ['🧹', 'clean cleaning limpar limpeza faxina organize organizar declutter arrumar tidy'],
  ['🧺', 'laundry lavar roupa roupas clothes wash passar'],
  ['🍽️', 'dishes louça dinner jantar lunch almoço restaurant restaurante'],
  ['🏠', 'home house casa apartment apartamento apê rent aluguel move mudança condomínio'],
  ['🔧', 'fix consertar repair reparo manutenção maintenance instalar install'],
  ['🪴', 'plant plants planta plantas garden jardim regar'],
  ['🐶', 'dog cachorro pet passear vet veterinário ração'],
  ['🐱', 'cat gato gata'],
  ['🚗', 'car carro drive dirigir oficina revisão ipva licenciamento'],
  ['✈️', 'travel viagem viajar flight voo trip airport aeroporto passport passaporte visa visto'],
  ['🏖️', 'vacation férias holiday praia feriado'],
  ['🧳', 'pack mala luggage bagagem'],
  ['🎁', 'gift presente presentes'],
  ['🎂', 'birthday aniversário cake bolo bake assar'],
  ['🎉', 'party festa celebrate comemorar celebration celebração'],
  ['❤️', 'love amor date namorar namorada namorado partner wife esposa husband marido casamento wedding'],
  ['👨‍👩‍👧', 'family família parents pais mom mãe dad pai kids filhos filho filha avó avô'],
  ['🍻', 'beer cerveja drinks bar pub boteco'],
  ['🍷', 'wine vinho'],
  ['🎮', 'game games jogo jogar videogame console playstation xbox switch'],
  ['📺', 'series série watch assistir tv netflix show'],
  ['🚀', 'launch lançar lançamento ship release startup project projeto mvp'],
  ['🎯', 'goal meta metas goals objective objetivo focus foco okr'],
  ['📝', 'notes notas todo list lista draft rascunho review revisar revisão'],
  ['📦', 'package pacote delivery entrega correios return devolver send enviar mandar'],
  ['🗂️', 'files arquivos documents documentos papers papéis admin burocracia bureaucracy cartório contrato contract'],
  ['🖨️', 'print imprimir impressão'],
  ['🌐', 'portfolio portfólio online internet web domain domínio'],
  ['📱', 'iphone celular instagram social linkedin tiktok post postar stories'],
  ['🎤', 'talk palestra presentation apresentação apresentar pitch speech discurso keynote'],
  ['🧪', 'test testar experiment experimento prototype protótipo'],
  ['🌱', 'start começar new novo nova habit hábito hábitos grow'],
  ['🙏', 'pray rezar church igreja gratitude gratidão thank agradecer'],
  ['🏆', 'win ganhar competition competição contest concurso award prêmio premiação'],
  ['🔒', 'password senha senhas security segurança backup'],
  ['👕', 'shirt camisa camiseta outfit look fashion moda'],
  ['👟', 'shoes sneakers sapato sapatos'],
  ['🌍', 'climate volunteer voluntário voluntariado world mundo ong'],
  ['🧩', 'puzzle problem problema solve resolver'],
  ['📖', 'bible bíblia poem poema poesia poetry'],
  ['🖌️', 'lettering caligrafia calligraphy type tipografia typography font fonte'],
  ['🧵', 'sew costurar crochet crochê tricô knit'],
];

export const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const INDEX = TABLE.map(([emoji, words]) => ({ emoji, keywords: normalize(words).split(' ') }));

/** Every emoji offered in the picker grid. */
export function suggest(text, limit = 6) {
  const words = normalize(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!words.length) return DEFAULT_EMOJI.slice(0, limit);

  const scores = new Map();
  INDEX.forEach(({ emoji, keywords }, order) => {
    let best = 0;
    for (const keyword of keywords) {
      words.forEach((word, position) => {
        const typing = position === words.length - 1;
        const recency = position * 0.05; // later words weigh a little more
        if (word === keyword) best = Math.max(best, 3 + recency);
        else if (word.length >= 3 && keyword.startsWith(word)) best = Math.max(best, (typing ? 2 : 1.2) + recency);
        else if (keyword.length >= 4 && word.startsWith(keyword)) best = Math.max(best, 2.2 + recency);
      });
    }
    if (best > 0) scores.set(emoji, Math.max(scores.get(emoji) ?? 0, best - order * 0.0001));
  });

  const ranked = [...scores].sort((a, b) => b[1] - a[1]).map(([e]) => e);
  return [...new Set([...ranked, ...DEFAULT_EMOJI])].slice(0, limit);
}
