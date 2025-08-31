import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;

// Configurações
const CONFIG = {
  PONTUACAO_BOLINHA: 10,
  PONTUACAO_POWER_UP: 50,
  PONTUACAO_FANTASMA: 200,
  VELOCIDADE_PACMAN: 5,
  VELOCIDADE_FANTASMA_NORMAL: 3,
  VELOCIDADE_FANTASMA_VULNERAVEL: 2,
  DURACAO_POWER_UP: 8000,
  VIDAS_INICIAIS: 3,
  UPDATE_INTERVAL: 1000 / 20
};

const TAMANHO_CELULA = 20;
const mestreCredencial = { login: "admin", senha: "1234" };

// Mapa completo do Pac-Man
const criarMapaPacman = () => {
  const mapa = Array(31).fill(0).map(() => Array(28).fill(0));
  
  // Paredes externas
  for (let i = 0; i < 28; i++) {
    mapa[0][i] = 1;
    mapa[30][i] = 1;
  }
  for (let i = 0; i < 31; i++) {
    mapa[i][0] = 1;
    mapa[i][27] = 1;
  }

  // Paredes internas
  const blocosHorizontais = [
    [3, 1, 10], [3, 17, 10], 
    [8, 1, 6], [8, 10, 6], [8, 17, 6], [8, 21, 6],
    [11, 1, 6], [11, 10, 6], [11, 17, 6], [11, 21, 6],
    [16, 1, 10], [16, 17, 10],
    [20, 1, 6], [20, 10, 6], [20, 17, 6], [20, 21, 6],
    [23, 1, 6], [23, 10, 6], [23, 17, 6], [23, 21, 6],
    [26, 1, 10], [26, 17, 10]
  ];

  blocosHorizontais.forEach(([y, x, length]) => {
    for (let i = 0; i < length; i++) {
      if (x + i < 28) mapa[y][x + i] = 1;
    }
  });

  const blocosVerticais = [
    [1, 5, 8], [1, 22, 8],
    [5, 13, 3], [5, 14, 3],
    [8, 7, 3], [8, 20, 3],
    [11, 7, 2], [11, 20, 2],
    [14, 13, 2], [14, 14, 2],
    [17, 7, 3], [17, 20, 3],
    [20, 7, 2], [20, 20, 2],
    [23, 13, 3], [23, 14, 3],
    [26, 5, 4], [26, 22, 4]
  ];

  blocosVerticais.forEach(([x, y, length]) => {
    for (let i = 0; i < length; i++) {
      if (x + i < 31) mapa[x + i][y] = 1;
    }
  });

  // Túneis
  mapa[15][0] = 0;
  mapa[15][27] = 0;

  // Power-ups
  mapa[3][1] = 3;
  mapa[3][26] = 3;
  mapa[23][1] = 3;
  mapa[23][26] = 3;

  // Bolinhas
  for (let i = 0; i < 31; i++) {
    for (let j = 0; j < 28; j++) {
      if (mapa[i][j] === 0) {
        mapa[i][j] = 2;
      }
    }
  }

  // Área central vazia
  for (let i = 12; i <= 18; i++) {
    for (let j = 11; j <= 16; j++) {
      mapa[i][j] = 0;
    }
  }

  return mapa;
};

class SalaJogo {
  constructor(id) {
    this.id = id;
    this.jogadores = [];
    this.jogoAtivo = false;
    this.campeao = null;
    this.mapa = criarMapaPacman();
    this.mapaPadrao = criarMapaPacman();
    this.fantasmas = this.inicializarFantasmas();
    this.powerUpAtivo = false;
    this.powerUpTimeout = null;
    this.tempoPowerUp = 0;
    this.bolinhasRestantes = this.contarBolinhas();
    
    // ✅ POSIÇÕES VÁLIDAS PARA SPAWN
    this.posicoesSpawn = [
      { x: 14 * 20, y: 23 * 20 },  // Posição tradicional
      { x: 14 * 20, y: 26 * 20 },  // Alternativa 1
      { x: 10 * 20, y: 23 * 20 },  // Alternativa 2
      { x: 18 * 20, y: 23 * 20 }   // Alternativa 3
    ];
  }

  inicializarFantasmas() {
    return [
      { id: 1, x: 14 * 20, y: 11 * 20, direcao: "DIREITA", vulneravel: false, cor: "red", alvo: null },
      { id: 2, x: 14 * 20, y: 14 * 20, direcao: "ESQUERDA", vulneravel: false, cor: "pink", alvo: null },
      { id: 3, x: 12 * 20, y: 14 * 20, direcao: "CIMA", vulneravel: false, cor: "cyan", alvo: null },
      { id: 4, x: 16 * 20, y: 14 * 20, direcao: "BAIXO", vulneravel: false, cor: "orange", alvo: null }
    ];
  }

  contarBolinhas() {
    let count = 0;
    for (let i = 0; i < this.mapa.length; i++) {
      for (let j = 0; j < this.mapa[i].length; j++) {
        if (this.mapa[i][j] === 2) count++;
      }
    }
    return count;
  }

  // ✅ FUNÇÃO PARA ENCONTRAR POSIÇÃO LIVRE
  encontrarPosicaoLivre() {
    for (const pos of this.posicoesSpawn) {
      const gridX = Math.floor(pos.x / 20);
      const gridY = Math.floor(pos.y / 20);
      
      // Verificar se a posição está livre (não é parede)
      if (gridY >= 0 && gridY < this.mapa.length && 
          gridX >= 0 && gridX < this.mapa[0].length && 
          this.mapa[gridY][gridX] !== 1) {
        return pos;
      }
    }
    
    // Fallback: posição padrão
    return { x: 14 * 20, y: 23 * 20 };
  }

  reiniciar() {
    if (this.powerUpTimeout) {
      clearTimeout(this.powerUpTimeout);
      this.powerUpTimeout = null;
    }
    
    this.mapa = JSON.parse(JSON.stringify(this.mapaPadrao));
    this.fantasmas = this.inicializarFantasmas();
    this.powerUpAtivo = false;
    this.bolinhasRestantes = this.contarBolinhas();
    this.jogoAtivo = true;
    this.campeao = null;
    
    this.jogadores.forEach(jogador => {
      // ✅ USAR POSIÇÃO LIVRE
      const posicaoLivre = this.encontrarPosicaoLivre();
      jogador.x = posicaoLivre.x;
      jogador.y = posicaoLivre.y;
      jogador.direcao = "DIREITA";
      jogador.vidas = CONFIG.VIDAS_INICIAIS;
      jogador.pontos = 0;
    });
  }

  adicionarJogador(id, nome) {
    // ✅ USAR POSIÇÃO LIVRE
    const posicaoLivre = this.encontrarPosicaoLivre();
    
    const jogador = {
      id,
      nome,
      pontos: 0,
      x: posicaoLivre.x,
      y: posicaoLivre.y,
      direcao: "DIREITA",
      vidas: CONFIG.VIDAS_INICIAIS,
      pronto: true
    };
    this.jogadores.push(jogador);
    
    console.log(`🎯 Jogador ${nome} spawn em: X=${jogador.x}, Y=${jogador.y}`);
    return jogador;
  }

  // ✅ VERIFICAÇÃO DE COLISÃO MELHORADA
  verificarColisaoParede(x, y) {
    const gridX = Math.floor(x / 20);
    const gridY = Math.floor(y / 20);
    
    // Permitir túneis
    if (gridX < 0 && gridY === 15) return false;
    if (gridX >= 28 && gridY === 15) return false;
    
    if (gridY < 0 || gridX < 0 || gridY >= this.mapa.length || gridX >= this.mapa[0].length) {
      return true;
    }
    
    return this.mapa[gridY][gridX] === 1;
  }

  // ✅ MOVIMENTO MELHORADO COM VERIFICAÇÃO DE MÚLTIPLOS PONTOS
  moverJogador(jogador) {
    if (!jogador.direcao) return false;

    const velocidade = CONFIG.VELOCIDADE_PACMAN;
    let novoX = jogador.x;
    let novoY = jogador.y;

    switch (jogador.direcao) {
      case "CIMA": novoY -= velocidade; break;
      case "BAIXO": novoY += velocidade; break;
      case "ESQUERDA": novoX -= velocidade; break;
      case "DIREITA": novoX += velocidade; break;
    }

    // ✅ VERIFICAÇÃO DE COLISÃO EM MÚLTIPLOS PONTOS
    const pontosVerificacao = [
      { x: novoX + 5, y: novoY + 5 },           // canto superior esquerdo
      { x: novoX + TAMANHO_CELULA - 5, y: novoY + 5 }, // canto superior direito
      { x: novoX + 5, y: novoY + TAMANHO_CELULA - 5 }, // canto inferior esquerdo
      { x: novoX + TAMANHO_CELULA - 5, y: novoY + TAMANHO_CELULA - 5 } // canto inferior direito
    ];

    let colisao = false;
    for (const ponto of pontosVerificacao) {
      if (this.verificarColisaoParede(ponto.x, ponto.y)) {
        colisao = true;
        break;
      }
    }
    
    if (!colisao) {
      const posicaoAnteriorX = jogador.x;
      const posicaoAnteriorY = jogador.y;
      
      jogador.x = novoX;
      jogador.y = novoY;
      
      // Túneis
      if (jogador.x < -20) jogador.x = 27 * 20;
      if (jogador.x > 28 * 20) jogador.x = -20;
      
      // Verificar se realmente mudou de posição
      const mudouPosicao = Math.abs(posicaoAnteriorX - jogador.x) > 1 || 
                           Math.abs(posicaoAnteriorY - jogador.y) > 1;
      
      if (mudouPosicao) {
        // Verificar colisões com itens
        this.verificarColisoesJogador(jogador);
      }
      
      return mudouPosicao;
    }
    return false;
  }

  moverFantasma(fantasma) {
    const velocidade = fantasma.vulneravel ? 
      CONFIG.VELOCIDADE_FANTASMA_VULNERAVEL : 
      CONFIG.VELOCIDADE_FANTASMA_NORMAL;
    
    const oldX = fantasma.x;
    const oldY = fantasma.y;
    
    switch (fantasma.direcao) {
      case "CIMA": fantasma.y -= velocidade; break;
      case "BAIXO": fantasma.y += velocidade; break;
      case "ESQUERDA": fantasma.x -= velocidade; break;
      case "DIREITA": fantasma.x += velocidade; break;
    }
    
    // Verificar colisão com paredes
    if (this.verificarColisaoParede(fantasma.x, fantasma.y)) {
      fantasma.x = oldX;
      fantasma.y = oldY;
      
      const direcoes = ["CIMA", "BAIXO", "ESQUERDA", "DIREITA"];
      fantasma.direcao = direcoes[Math.floor(Math.random() * direcoes.length)];
      return;
    }
    
    // Túneis
    if (fantasma.x < -20) fantasma.x = 27 * 20;
    if (fantasma.x > 28 * 20) fantasma.x = -20;
    
    // IA: perseguir jogador mais próximo
    if (Math.random() < 0.1 || !fantasma.alvo) {
      let jogadorMaisProximo = null;
      let menorDistancia = Infinity;
      
      for (const jogador of this.jogadores) {
        const distancia = Math.sqrt(
          Math.pow(jogador.x - fantasma.x, 2) + 
          Math.pow(jogador.y - fantasma.y, 2)
        );
        
        if (distancia < menorDistancia) {
          menorDistancia = distancia;
          jogadorMaisProximo = jogador;
        }
      }
      
      fantasma.alvo = jogadorMaisProximo;
    }
    
    // Perseguir alvo
    if (fantasma.alvo && Math.random() < 0.7) {
      const dx = fantasma.alvo.x - fantasma.x;
      const dy = fantasma.alvo.y - fantasma.y;
      
      if (Math.abs(dx) > Math.abs(dy)) {
        fantasma.direcao = dx > 0 ? "DIREITA" : "ESQUERDA";
      } else {
        fantasma.direcao = dy > 0 ? "BAIXO" : "CIMA";
      }
    }
    
    // Verificar colisão com jogadores
    for (const jogador of this.jogadores) {
      const distancia = Math.sqrt(
        Math.pow(jogador.x - fantasma.x, 2) + 
        Math.pow(jogador.y - fantasma.y, 2)
      );
      
      if (distancia < 15) {
        this.processarColisaoFantasma(fantasma, jogador);
        break;
      }
    }
  }

  verificarColisoesJogador(jogador) {
    const gridX = Math.floor(jogador.x / 20);
    const gridY = Math.floor(jogador.y / 20);
    
    if (gridY < 0 || gridX < 0 || gridY >= this.mapa.length || gridX >= this.mapa[0].length) {
      return;
    }
    
    const celula = this.mapa[gridY][gridX];
    
    if (celula === 2) {
      this.mapa[gridY][gridX] = 0;
      jogador.pontos += CONFIG.PONTUACAO_BOLINHA;
      this.bolinhasRestantes--;
      
      io.to(this.id).emit("bolinhaComida", {
        x: gridX,
        y: gridY,
        pontos: jogador.pontos,
        jogador: jogador.name,
        bolinhasRestantes: this.bolinhasRestantes
      });

      io.to(this.id).emit("mapaAtualizado", {
        mapa: this.mapa,
        x: gridX,
        y: gridY
      });

      if (this.bolinhasRestantes === 0) {
        this.jogoAtivo = false;
        this.campeao = jogador.nome;
        io.to(this.id).emit("vitoria", {
          campeao: jogador.nome,
          pontos: jogador.pontos
        });
      }
    }
    
    if (celula === 3) {
      this.mapa[gridY][gridX] = 0;
      jogador.pontos += CONFIG.PONTUACAO_POWER_UP;
      this.powerUpAtivo = true;
      this.fantasmas.forEach(f => f.vulneravel = true);
      
      io.to(this.id).emit("powerUpAtivado", {
        x: gridX,
        y: gridY,
        pontos: jogador.pontos,
        jogador: jogador.nome
      });

      io.to(this.id).emit("mapaAtualizado", {
        mapa: this.mapa,
        x: gridX,
        y: gridY
      });

      if (this.powerUpTimeout) clearTimeout(this.powerUpTimeout);
      
      this.powerUpTimeout = setTimeout(() => {
        if (this.powerUpAtivo) {
          this.powerUpAtivo = false;
          this.fantasmas.forEach(f => f.vulneravel = false);
          io.to(this.id).emit("powerUpDesativado");
        }
      }, CONFIG.DURACAO_POWER_UP);
    }
  }

  processarColisaoFantasma(fantasma, jogador) {
    if (fantasma.vulneravel) {
      jogador.pontos += CONFIG.PONTUACAO_FANTASMA;
      const posicoes = [
        { x: 14 * 20, y: 11 * 20 },
        { x: 14 * 20, y: 14 * 20 },
        { x: 12 * 20, y: 14 * 20 },
        { x: 16 * 20, y: 14 * 20 }
      ];
      const pos = posicoes[fantasma.id - 1];
      fantasma.x = pos.x;
      fantasma.y = pos.y;
      fantasma.vulneravel = false;
      
      io.to(this.id).emit("fantasmaComido", {
        jogador: jogador.nome,
        pontos: jogador.pontos
      });
    } else {
      jogador.vidas--;
      // ✅ USAR POSIÇÃO LIVRE AO SER ATINGIDO
      const posicaoLivre = this.encontrarPosicaoLivre();
      jogador.x = posicaoLivre.x;
      jogador.y = posicaoLivre.y;
      
      io.to(this.id).emit("jogadorAtingido", {
        jogador: jogador.nome,
        vidas: jogador.vidas
      });
      
      if (jogador.vidas <= 0) {
        io.to(this.id).emit("jogadorDerrotado", { jogador: jogador.nome });
        
        const jogadoresVivos = this.jogadores.filter(j => j.vidas > 0);
        if (jogadoresVivos.length === 0) {
          this.jogoAtivo = false;
          io.to(this.id).emit("jogoTerminado", {
            motivo: "Todos os jogadores foram derrotados"
          });
        }
      }
    }
  }
}

const salas = new Map();
salas.set("default", new SalaJogo("default"));

app.get("/health", (req, res) => {
  res.json({ 
    status: "online", 
    salas: salas.size,
    totalJogadores: Array.from(salas.values()).reduce((acc, sala) => acc + sala.jogadores.length, 0)
  });
});

app.get("/info", (req, res) => {
  const infoSalas = Array.from(salas.values()).map(sala => ({
    id: sala.id,
    jogadores: sala.jogadores.length,
    jogoAtivo: sala.jogoAtivo,
    campeao: sala.campeao
  }));
  res.json({ salas: infoSalas });
});

io.on("connection", (socket) => {
  console.log("👤 Novo jogador conectado:", socket.id);
  let salaAtual = null;
  let jogadorAtual = null;

  socket.on("entrarSala", ({ nome, salaId = "default" }) => {
    try {
      if (!nome || nome.trim().length === 0) {
        socket.emit("erro", { mensagem: "Nome inválido" });
        return;
      }

      nome = nome.trim().substring(0, 15);

      if (!salas.has(salaId)) {
        salas.set(salaId, new SalaJogo(salaId));
        console.log(`🎮 Nova sala criada: ${salaId}`);
      }

      salaAtual = salas.get(salaId);
      
      jogadorAtual = salaAtual.jogadores.find(j => j.id === socket.id);
      
      if (!jogadorAtual) {
        jogadorAtual = salaAtual.adicionarJogador(socket.id, nome);
        console.log(`🎯 Jogador entrou: ${nome} (${salaId})`);
      }

      socket.join(salaId);
      
      socket.emit("estadoJogo", {
        jogador: jogadorAtual,
        mapa: salaAtual.mapa,
        fantasmas: salaAtual.fantasmas,
        jogadores: salaAtual.jogadores,
        jogoAtivo: salaAtual.jogoAtivo,
        bolinhasRestantes: salaAtual.bolinhasRestantes
      });

      socket.to(salaId).emit("jogadoresAtualizados", salaAtual.jogadores);

    } catch (error) {
      console.error("Erro ao entrar na sala:", error);
      socket.emit("erro", { mensagem: "Erro interno do servidor" });
    }
  });

  socket.on("movimento", ({ direcao }) => {
    if (!salaAtual || !jogadorAtual || !salaAtual.jogoAtivo) return;
    
    jogadorAtual.direcao = direcao;
    
    socket.to(salaAtual.id).emit("movimentoJogador", {
      id: socket.id,
      direcao
    });
  });

  socket.on("loginMestre", ({ login, senha }) => {
    const isMestre = login === mestreCredencial.login && senha === mestreCredencial.senha;
    socket.emit("mestre", isMestre);
    
    if (isMestre) {
      console.log(`👑 Mestre autenticado: ${socket.id}`);
    }
  });

  socket.on("iniciarJogo", () => {
    if (salaAtual) {
      salaAtual.reiniciar();
      console.log(`🎮 Jogo iniciado na sala: ${salaAtual.id}`);
      
      io.to(salaAtual.id).emit("jogoIniciado", {
        mapa: salaAtual.mapa,
        fantasmas: salaAtual.fantasmas,
        jogadores: salaAtual.jogadores,
        jogoAtivo: true,
        bolinhasRestantes: salaAtual.bolinhasRestantes
      });
      
      salaAtual.jogadores.forEach(jogador => {
        io.to(jogador.id).emit("estadoJogador", {
          jogador: jogador,
          vidas: jogador.vidas,
          pontos: jogador.pontos
        });
      });
    }
  });

  socket.on("disconnect", () => {
    console.log("👋 Jogador desconectado:", socket.id);
    
    if (salaAtual && jogadorAtual) {
      salaAtual.jogadores = salaAtual.jogadores.filter(j => j.id !== socket.id);
      socket.to(salaAtual.id).emit("jogadoresAtualizados", salaAtual.jogadores);
      
      if (salaAtual.jogadores.length === 0 && salaAtual.id !== "default") {
        salas.delete(salaAtual.id);
        console.log(`🗑️ Sala removida: ${salaAtual.id}`);
      }
    }
  });
});

// Game loop principal
setInterval(() => {
  salas.forEach(sala => {
    if (sala.jogoAtivo) {
      // Filtrar jogadores desconectados
      sala.jogadores = sala.jogadores.filter(jogador => {
        const socket = io.sockets.sockets.get(jogador.id);
        return socket && socket.connected;
      });
      
      if (sala.jogadores.length === 0) {
        sala.jogoAtivo = false;
        return;
      }
      
      // Mover jogadores
      sala.jogadores.forEach(jogador => {
        const movimentoBemSucedido = sala.moverJogador(jogador);
        if (movimentoBemSucedido) {
          io.to(sala.id).emit("jogadorMovido", {
            id: jogador.id,
            x: jogador.x,
            y: jogador.y,
            direcao: jogador.direcao
          });
        }
      });
      
      // Mover fantasmas
      sala.fantasmas.forEach(fantasma => {
        sala.moverFantasma(fantasma);
      });
      
      // Atualizar clientes
      io.to(sala.id).emit("estadoAtualizado", {
        jogadores: sala.jogadores,
        fantasmas: sala.fantasmas,
        bolinhasRestantes: sala.bolinhasRestantes
      });
    }
  });
}, CONFIG.UPDATE_INTERVAL);

server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`🎯 Velocidade Pac-Man: ${CONFIG.VELOCIDADE_PACMAN}px/frame`);
  console.log(`👻 Velocidade Fantasmas: ${CONFIG.VELOCIDADE_FANTASMA_NORMAL}px/frame`);
  console.log(`📊 FPS: ${Math.round(1000/CONFIG.UPDATE_INTERVAL)}`);
});