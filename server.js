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
  VELOCIDADE_PACMAN_TURBO: 10,
  VELOCIDADE_FANTASMA_NORMAL: 3,
  VELOCIDADE_FANTASMA_VULNERAVEL: 2,
  DURACAO_POWER_UP: 8000,
  DURACAO_PODER_ELIMINAR: 10000,
  DURACAO_VELOCIDADE_TURBO: 5000,
  SPAWN_FRUTA_INTERVALO: 30000,
  VIDAS_INICIAIS: 3,
  UPDATE_INTERVAL: 1000 / 20,
  TEMPO_PADRAO: 180
};

const TAMANHO_CELULA = 20;
const mestreCredencial = { login: "admin", senha: "senac127" };

// Função para serializar objetos evitando referências circulares
const serializarObjeto = (obj) => {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => serializarObjeto(item));
  }
  
  const result = {};
  for (const key in obj) {
    if (key === 'socket' || key === 'alvo' || key === 'poderEliminarTimeout' || key === 'powerUpTimeout' || key === 'velocidadeTurboTimeout') {
      continue;
    }
    
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      result[key] = serializarObjeto(obj[key]);
    } else {
      result[key] = obj[key];
    }
  }
  
  return result;
};

// Mapa completo do Pac-Man
const criarMapaPacman = () => {
  const mapa = Array(31).fill(0).map(() => Array(28).fill(0));
  
  // Paredes externas - apenas o contorno
  for (let i = 0; i < 28; i++) {
    mapa[0][i] = 1;
    mapa[30][i] = 1;
  }
  for (let i = 0; i < 31; i++) {
    mapa[i][0] = 1;
    mapa[i][27] = 1;
  }

  // Remove as paredes dos túneis
  mapa[15][0] = 0;
  mapa[15][27] = 0;

  // Define os blocos de paredes internas
  const paredes = [
    [3, 1, 8], [3, 19, 8],
    [8, 1, 6], [8, 10, 2], [8, 16, 2], [8, 21, 6],
    [11, 1, 6], [11, 10, 2], [11, 16, 2], [11, 21, 6],
    [16, 1, 8], [16, 19, 8],
    [20, 1, 6], [20, 10, 2], [20, 16, 2], [20, 21, 6],
    [23, 1, 6], [23, 10, 2], [23, 16, 2], [23, 21, 6],
    [26, 1, 8], [26, 19, 8],
    
    // Blocos verticais
    [1, 5, 5], [1, 22, 5],
    [5, 13, 2], [5, 14, 2],
    [8, 7, 2], [8, 20, 2],
    [11, 7, 2], [11, 20, 2],
    [14, 13, 2], [14, 14, 2],
    [17, 7, 2], [17, 20, 2],
    [20, 7, 2], [20, 20, 2],
    [23, 13, 2], [23, 14, 2],
    [26, 5, 3], [26, 22, 3]
  ];

  // Aplica as paredes ao mapa
  paredes.forEach(([y, x, length]) => {
    for (let i = 0; i < length; i++) {
      if (x + i < 28) mapa[y][x + i] = 1;
    }
  });

  // Power-ups (frutas grandes) nas quatro esquinas
  mapa[3][1] = 3;
  mapa[3][26] = 3;
  mapa[23][1] = 3;
  mapa[23][26] = 3;

  // Bolinhas em todos os caminhos vazios
  for (let i = 0; i < 31; i++) {
    for (let j = 0; j < 28; j++) {
      if (mapa[i][j] === 0) {
        mapa[i][j] = 2;
      }
    }
  }

  // Área central vazia (base dos fantasmas)
  for (let i = 12; i <= 18; i++) {
    for (let j = 11; j <= 16; j++) {
      mapa[i][j] = 0;
    }
  }

  // Garante que os túneis tenham bolinhas
  mapa[15][0] = 2;
  mapa[15][27] = 2;

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
    this.bolinhasRestantes = this.contarBolinhas();
    this.tempoJogo = CONFIG.TEMPO_PADRAO;
    this.tempoRestante = CONFIG.TEMPO_PADRAO;
    this.cronometroInterval = null;
    this.modoCronometro = false;
    this.frutaSpawnInterval = null;
    this.frutasAtivas = [];
    
    this.posicoesSpawn = [
      { x: 14 * 20, y: 23 * 20 },
      { x: 14 * 20, y: 26 * 20 },
      { x: 10 * 20, y: 23 * 20 },
      { x: 18 * 20, y: 23 * 20 }
    ];
    
    this.posicoesFruta = [
      { x: 3, y: 1 }, { x: 3, y: 26 }, { x: 23, y: 1 }, { x: 23, y: 26 },
      { x: 1, y: 5 }, { x: 1, y: 22 }, { x: 29, y: 5 }, { x: 29, y: 22 },
      { x: 8, y: 10 }, { x: 8, y: 17 }, { x: 20, y: 10 }, { x: 20, y: 17 }
    ];
  }

  inicializarFantasmas() {
    return [
      { id: 1, x: 14 * 20, y: 11 * 20, direcao: "DIREITA", vulneravel: false, cor: "red" },
      { id: 2, x: 14 * 20, y: 14 * 20, direcao: "ESQUERDA", vulneravel: false, cor: "pink" },
      { id: 3, x: 12 * 20, y: 14 * 20, direcao: "CIMA", vulneravel: false, cor: "cyan" },
      { id: 4, x: 16 * 20, y: 14 * 20, direcao: "BAIXO", vulneravel: false, cor: "orange" }
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

  limparJogadoresEliminados() {
    this.jogadores = this.jogadores.filter(jogador => jogador.vidas > 0);
  }

  encontrarPosicaoLivre() {
    for (const pos of this.posicoesSpawn) {
      const gridX = Math.floor(pos.x / 20);
      const gridY = Math.floor(pos.y / 20);
      
      if (gridY >= 0 && gridY < this.mapa.length && 
          gridX >= 0 && gridX < this.mapa[0].length && 
          this.mapa[gridY][gridX] !== 1) {
        return pos;
      }
    }
    
    return { x: 14 * 20, y: 23 * 20 };
  }

  iniciarCronometro() {
    if (this.cronometroInterval) {
      clearInterval(this.cronometroInterval);
    }
    
    this.tempoRestante = this.tempoJogo;
    this.modoCronometro = true;
    
    this.cronometroInterval = setInterval(() => {
      this.tempoRestante--;
      
      io.to(this.id).emit("atualizarTempo", {
        tempoRestante: this.tempoRestante,
        tempoTotal: this.tempoJogo
      });
      
      if (this.tempoRestante <= 0) {
        this.finalizarJogoPorTempo();
        clearInterval(this.cronometroInterval);
      }
    }, 1000);
  }

  finalizarJogoPorTempo() {
    this.jogoAtivo = false;
    this.modoCronometro = false;
    
    let vencedor = null;
    let maiorPontuacao = -1;
    
    for (const jogador of this.jogadores) {
      if (jogador.pontos > maiorPontuacao && !jogador.espectador) {
        maiorPontuacao = jogador.pontos;
        vencedor = jogador;
      }
    }
    
    if (vencedor) {
      this.campeao = vencedor.nome;
      console.log(`⏰ TEMPO ESGOTADO: ${vencedor.nome} venceu com ${vencedor.pontos} pontos!`);
      
      io.to(this.id).emit("vitoriaTempo", {
        campeao: vencedor.nome,
        pontos: vencedor.pontos,
        jogadores: this.jogadores.map(j => ({
          id: j.id,
          nome: j.nome,
          pontos: j.pontos,
          vidas: j.vidas
        }))
      });
    } else {
      console.log("⏰ TEMPO ESGOTADO: Nenhum jogador para vencer");
      
      io.to(this.id).emit("jogoTerminado", {
        motivo: "Tempo esgotado - Nenhum jogador vencedor"
      });
    }
    
    if (this.cronometroInterval) {
      clearInterval(this.cronometroInterval);
      this.cronometroInterval = null;
    }
  }

  pararCronometro() {
    if (this.cronometroInterval) {
      clearInterval(this.cronometroInterval);
      this.cronometroInterval = null;
    }
    this.modoCronometro = false;
  }

  definirTempoJogo(tempoSegundos) {
    this.tempoJogo = tempoSegundos;
    this.tempoRestante = tempoSegundos;
    
    io.to(this.id).emit("tempoDefinido", {
      tempoJogo: this.tempoJogo,
      tempoRestante: this.tempoRestante
    });
  }

  iniciarSpawnFrutas() {
    if (this.frutaSpawnInterval) {
      clearInterval(this.frutaSpawnInterval);
    }
    
    this.frutaSpawnInterval = setInterval(() => {
      if (!this.jogoAtivo) return;
      
      const posicoesDisponiveis = this.posicoesFruta.filter(pos => 
        this.mapa[pos.y] && this.mapa[pos.y][pos.x] === 0
      );
      
      if (posicoesDisponiveis.length > 0) {
        const posicao = posicoesDisponiveis[Math.floor(Math.random() * posicoesDisponiveis.length)];
        
        this.mapa[posicao.y][posicao.x] = 4;
        
        this.frutasAtivas.push({ x: posicao.x, y: posicao.y });
        
        console.log(`🍒 Fruta spawnada em: X=${posicao.x}, Y=${posicao.y}`);
        
        io.to(this.id).emit("frutaSpawnada", {
          x: posicao.x,
          y: posicao.y
        });
      }
    }, CONFIG.SPAWN_FRUTA_INTERVALO);
  }

  pararSpawnFrutas() {
    if (this.frutaSpawnInterval) {
      clearInterval(this.frutaSpawnInterval);
      this.frutaSpawnInterval = null;
    }
    
    this.frutasAtivas.forEach(fruta => {
      if (this.mapa[fruta.y] && this.mapa[fruta.y][fruta.x] === 4) {
        this.mapa[fruta.y][fruta.x] = 0;
      }
    });
    this.frutasAtivas = [];
  }

  reiniciar() {
    if (this.powerUpTimeout) {
      clearTimeout(this.powerUpTimeout);
      this.powerUpTimeout = null;
    }
    
    if (this.cronometroInterval) {
      clearInterval(this.cronometroInterval);
      this.cronometroInterval = null;
    }
    
    this.pararSpawnFrutas();
    
    this.mapa = JSON.parse(JSON.stringify(this.mapaPadrao));
    this.fantasmas = this.inicializarFantasmas();
    this.powerUpAtivo = false;
    this.bolinhasRestantes = this.contarBolinhas();
    this.jogoAtivo = true;
    this.campeao = null;
    this.tempoRestante = this.tempoJogo;
    this.modoCronometro = false;
    this.frutasAtivas = [];
    
    this.jogadores = this.jogadores.filter(jogador => jogador.vidas > 0 || jogador.espectador);
    
    this.jogadores.forEach(jogador => {
      if (!jogador.espectador) {
        const posicaoLivre = this.encontrarPosicaoLivre();
        jogador.x = posicaoLivre.x;
        jogador.y = posicaoLivre.y;
        jogador.direcao = "DIREITA";
        jogador.vidas = CONFIG.VIDAS_INICIAIS;
        jogador.pontos = 0;
        jogador.podeEliminar = false;
        jogador.tempoPoderEliminar = 0;
        jogador.velocidadeTurbo = false;
        jogador.tempoVelocidadeTurbo = 0;
        
        if (jogador.poderEliminarTimeout) {
          clearTimeout(jogador.poderEliminarTimeout);
          jogador.poderEliminarTimeout = null;
        }
        
        if (jogador.velocidadeTurboTimeout) {
          clearTimeout(jogador.velocidadeTurboTimeout);
          jogador.velocidadeTurboTimeout = null;
        }
      }
    });
    
    this.iniciarSpawnFrutas();
    
    console.log(`🔄 Jogo reiniciado. Jogadores ativos: ${this.jogadores.filter(j => !j.espectador).length}`);
  }

  adicionarJogador(id, nome, espectador = false) {
    const posicaoLivre = this.encontrarPosicaoLivre();
    
    const jogador = {
      id,
      nome,
      pontos: 0,
      x: posicaoLivre.x,
      y: posicaoLivre.y,
      direcao: "DIREITA",
      vidas: espectador ? 0 : CONFIG.VIDAS_INICIAIS,
      pronto: true,
      espectador: espectador,
      podeEliminar: false,
      tempoPoderEliminar: 0,
      poderEliminarTimeout: null,
      velocidadeTurbo: false,
      tempoVelocidadeTurbo: 0,
      velocidadeTurboTimeout: null
    };
    this.jogadores.push(jogador);
    
    console.log(`🎯 ${espectador ? 'Espectador' : 'Jogador'} ${nome} entrou na sala ${this.id}`);
    return jogador;
  }

  verificarColisaoParede(x, y) {
    const gridX = Math.floor(x / 20);
    const gridY = Math.floor(y / 20);
    
    if (gridX < 0 && gridY === 15) return false;
    if (gridX >= 28 && gridY === 15) return false;
    
    if (gridY < 0 || gridX < 0 || gridY >= this.mapa.length || gridX >= this.mapa[0].length) {
      return true;
    }
    
    return this.mapa[gridY][gridX] === 1;
  }

  verificarColisaoJogadores(jogador1, jogador2) {
    const distancia = Math.sqrt(
      Math.pow(jogador1.x - jogador2.x, 2) + 
      Math.pow(jogador1.y - jogador2.y, 2)
    );
    return distancia < 20;
  }

  ativarPoderEliminar(jogador) {
    jogador.podeEliminar = true;
    jogador.tempoPoderEliminar = CONFIG.DURACAO_PODER_ELIMINAR;
    
    console.log(`⚡ ${jogador.nome} ativou poder de eliminar jogadores!`);
    
    io.to(this.id).emit("poderEliminarAtivado", {
      jogadorId: jogador.id,
      jogadorNome: jogador.nome,
      tempo: CONFIG.DURACAO_PODER_ELIMINAR
    });
    
    jogador.poderEliminarTimeout = setTimeout(() => {
      if (jogador.podeEliminar) {
        jogador.podeEliminar = false;
        jogador.tempoPoderEliminar = 0;
        console.log(`⏰ Poder de eliminar de ${jogador.nome} expirou`);
        
        io.to(this.id).emit("poderEliminarDesativado", {
          jogadorId: jogador.id
        });
      }
    }, CONFIG.DURACAO_PODER_ELIMINAR);
  }

  ativarVelocidadeTurbo(jogador) {
    jogador.velocidadeTurbo = true;
    jogador.tempoVelocidadeTurbo = CONFIG.DURACAO_VELOCIDADE_TURBO;
    
    console.log(`⚡ ${jogador.nome} ativou velocidade turbo!`);
    
    io.to(this.id).emit("velocidadeTurboAtivada", {
      jogadorId: jogador.id,
      jogadorNome: jogador.nome,
      tempo: CONFIG.DURACAO_VELOCIDADE_TURBO
    });
    
    jogador.velocidadeTurboTimeout = setTimeout(() => {
      if (jogador.velocidadeTurbo) {
        jogador.velocidadeTurbo = false;
        jogador.tempoVelocidadeTurbo = 0;
        console.log(`⏰ Velocidade turbo de ${jogador.nome} expirou`);
        
        io.to(this.id).emit("velocidadeTurboDesativada", {
          jogadorId: jogador.id
        });
      }
    }, CONFIG.DURACAO_VELOCIDADE_TURBO);
  }

  moverJogador(jogador) {
    if (!jogador.direcao || jogador.espectador) return false;

    const velocidade = jogador.velocidadeTurbo ? 
      CONFIG.VELOCIDADE_PACMAN_TURBO : 
      CONFIG.VELOCIDADE_PACMAN;
    
    let novoX = jogador.x;
    let novoY = jogador.y;

    switch (jogador.direcao) {
      case "CIMA": novoY -= velocidade; break;
      case "BAIXO": novoY += velocidade; break;
      case "ESQUERDA": novoX -= velocidade; break;
      case "DIREITA": novoX += velocidade; break;
    }

    const pontosVerificacao = [
      { x: novoX + 5, y: novoY + 5 },
      { x: novoX + TAMANHO_CELULA - 5, y: novoY + 5 },
      { x: novoX + 5, y: novoY + TAMANHO_CELULA - 5 },
      { x: novoX + TAMANHO_CELULA - 5, y: novoY + TAMANHO_CELULA - 5 }
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
      
      if (jogador.x < -20) jogador.x = 27 * 20;
      if (jogador.x > 28 * 20) jogador.x = -20;
      
      const mudouPosicao = Math.abs(posicaoAnteriorX - jogador.x) > 1 || 
                           Math.abs(posicaoAnteriorY - jogador.y) > 1;
      
      if (mudouPosicao) {
        this.verificarColisoesJogador(jogador);
        
        if (jogador.podeEliminar) {
          this.verificarColisoesEliminacao(jogador);
        }
      }
      
      return mudouPosicao;
    }
    return false;
  }

  verificarColisoesEliminacao(jogadorComPoder) {
    for (const outroJogador of this.jogadores) {
      if (outroJogador.id !== jogadorComPoder.id && 
          !outroJogador.espectador && 
          outroJogador.vidas > 0 &&
          this.verificarColisaoJogadores(jogadorComPoder, outroJogador)) {
        
        this.eliminarJogador(jogadorComPoder, outroJogador);
        break;
      }
    }
  }

  eliminarJogador(jogadorComPoder, jogadorAlvo) {
    console.log(`⚡ ${jogadorComPoder.nome} ELIMINOU ${jogadorAlvo.nome} com o poder especial!`);
    
    jogadorAlvo.vidas = 0;
    
    jogadorComPoder.pontos += CONFIG.PONTUACAO_FANTASMA * 2;
    
    this.jogadores = this.jogadores.filter(j => j.id !== jogadorAlvo.id);
    
    io.to(this.id).emit("jogadorEliminadoPoder", {
      eliminadorId: jogadorComPoder.id,
      eliminadorNome: jogadorComPoder.nome,
      jogadorEliminadoId: jogadorAlvo.id,
      jogadorEliminadoNome: jogadorAlvo.nome,
      jogadores: this.jogadores.map(j => ({
        id: j.id,
        nome: j.nome,
        vidas: j.vidas,
        pontos: j.pontos
      }))
    });
    
    const jogadoresVivos = this.jogadores.filter(j => j.vidas > 0 && !j.espectador);
    if (jogadoresVivos.length === 0) {
      this.jogoAtivo = false;
      this.campeao = jogadorComPoder.nome;
      console.log(`🏆 ${jogadorComPoder.nome} venceu eliminando todos os jogadores!`);
      
      io.to(this.id).emit("vitoria", {
        campeao: jogadorComPoder.nome,
        pontos: jogadorComPoder.pontos
      });
    } else if (jogadoresVivos.length === 1) {
      this.jogoAtivo = false;
      this.campeao = jogadoresVivos[0].nome;
      console.log(`🏆 ${jogadoresVivos[0].nome} é o último sobrevivente!`);
      
      io.to(this.id).emit("vitoria", {
        campeao: jogadoresVivos[0].nome,
        pontos: jogadoresVivos[0].pontos
      });
    }
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
    
    if (this.verificarColisaoParede(fantasma.x, fantasma.y)) {
      fantasma.x = oldX;
      fantasma.y = oldY;
      
      const direcoes = ["CIMA", "BAIXO", "ESQUERDA", "DIREITA"];
      fantasma.direcao = direcoes[Math.floor(Math.random() * direcoes.length)];
      return;
    }
    
    if (fantasma.x < -20) fantasma.x = 27 * 20;
    if (fantasma.x > 28 * 20) fantasma.x = -20;
    
    if (Math.random() < 0.1) {
      let jogadorMaisProximo = null;
      let menorDistancia = Infinity;
      
      for (const jogador of this.jogadores) {
        if (jogador.espectador) continue;
        const distancia = Math.sqrt(
          Math.pow(jogador.x - fantasma.x, 2) + 
          Math.pow(jogador.y - fantasma.y, 2)
        );
        
        if (distancia < menorDistancia) {
          menorDistancia = distancia;
          jogadorMaisProximo = jogador;
        }
      }
      
      if (jogadorMaisProximo) {
        const dx = jogadorMaisProximo.x - fantasma.x;
        const dy = jogadorMaisProximo.y - fantasma.y;
        
        if (Math.abs(dx) > Math.abs(dy)) {
          fantasma.direcao = dx > 0 ? "DIREITA" : "ESQUERDA";
        } else {
          fantasma.direcao = dy > 0 ? "BAIXO" : "CIMA";
        }
      }
    }
    
    for (const jogador of this.jogadores) {
      if (jogador.espectador) continue;
      
      const distancia = Math.sqrt(
        Math.pow(jogador.x - fantasma.x, 2) + 
        Math.pow(jogador.y - fantasma.y, 2)
      );
      
      if (distancia < 15) {
        console.log(`📍 Fantasma ${fantasma.id} perto de ${jogador.nome} (distância: ${distancia.toFixed(1)})`);
        this.processarColisaoFantasma(fantasma, jogador);
        break;
      }
    }
  }

  verificarColisoesJogador(jogador) {
    if (jogador.espectador) return;
    
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
        jogadores: this.jogadores.map(j => ({ id: j.id, pontos: j.pontos })),
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
        this.limparJogadoresEliminados();
        console.log(`🏆 VITÓRIA: ${jogador.nome} coletou todas as bolinhas!`);
        io.to(this.id).emit("vitoria", {
          campeao: jogador.nome,
          pontos: jogador.pontos
        });
      }
    }
    
    if (celula === 3) {
      this.mapa[gridY][gridX] = 0;
      jogador.pontos += CONFIG.PONTUACAO_POWER_UP;
      
      this.ativarPoderEliminar(jogador);
      
      this.powerUpAtivo = true;
      this.fantasmas.forEach(f => f.vulneravel = true);
      
      io.to(this.id).emit("powerUpAtivado", {
        x: gridX,
        y: gridY,
        jogadores: this.jogadores.map(j => ({ id: j.id, pontos: j.pontos }))
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
    
    if (celula === 4) {
      this.mapa[gridY][gridX] = 0;
      jogador.pontos += CONFIG.PONTUACAO_POWER_UP;
      
      this.frutasAtivas = this.frutasAtivas.filter(f => 
        !(f.x === gridX && f.y === gridY)
      );
      
      this.ativarVelocidadeTurbo(jogador);
      
      io.to(this.id).emit("frutaComida", {
        x: gridX,
        y: gridY,
        jogadorId: jogador.id,
        jogadorNome: jogador.nome,
        jogadores: this.jogadores.map(j => ({ id: j.id, pontos: j.pontos }))
      });

      io.to(this.id).emit("mapaAtualizado", {
        mapa: this.mapa,
        x: gridX,
        y: gridY
      });
    }
  }

  processarColisaoFantasma(fantasma, jogadorAtingido) {
    if (jogadorAtingido.espectador) return;
    
    console.log(`👻 Fantasma ${fantasma.id} colidiu com ${jogadorAtingido.nome} (ID: ${jogadorAtingido.id})`);
    
    if (fantasma.vulneravel) {
      jogadorAtingido.pontos += CONFIG.PONTUACAO_FANTASMA;
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
      
      console.log(`🎯 ${jogadorAtingido.nome} comeu fantasma! Pontos: ${jogadorAtingido.pontos}`);
      
      io.to(this.id).emit("fantasmaComido", {
        jogadorId: jogadorAtingido.id,
        jogadores: this.jogadores.map(j => ({ 
          id: j.id, 
          pontos: j.pontos 
        }))
      });
    } else {
      const novasVidas = Math.max(0, jogadorAtingido.vidas - 1);
      console.log(`💥 ${jogadorAtingido.nome} foi comido! Vidas: ${jogadorAtingido.vidas} -> ${novasVidas}`);
      jogadorAtingido.vidas = novasVidas;
      
      if (jogadorAtingido.vidas <= 0) {
        console.log(`💀 Jogador ${jogadorAtingido.nome} foi ELIMINADO`);
        
        this.jogadores = this.jogadores.filter(j => j.id !== jogadorAtingido.id);
        
        io.to(this.id).emit("jogadorEliminado", { 
          jogadorId: jogadorAtingido.id,
          jogadorNome: jogadorAtingido.nome,
          jogadores: this.jogadores.map(j => ({
            id: j.id,
            nome: j.nome,
            vidas: j.vidas,
            pontos: j.pontos
          }))
        });
        
        const jogadoresVivos = this.jogadores.filter(j => j.vidas > 0 && !j.espectador);
        if (jogadoresVivos.length === 0) {
          this.jogoAtivo = false;
          this.limparJogadoresEliminados();
          io.to(this.id).emit("jogoTerminado", {
            motivo: "Todos os jogadores foram eliminados"
          });
        } else if (jogadoresVivos.length === 1) {
          this.jogoAtivo = false;
          this.campeao = jogadoresVivos[0].nome;
          this.limparJogadoresEliminados();
          console.log(`🏆 VITÓRIA: ${jogadoresVivos[0].nome} é o último sobrevivente!`);
          io.to(this.id).emit("vitoria", {
            campeao: jogadoresVivos[0].nome,
            pontos: jogadoresVivos[0].pontos
          });
        }
      } else {
        const posicaoLivre = this.encontrarPosicaoLivre();
        jogadorAtingido.x = posicaoLivre.x;
        jogadorAtingido.y = posicaoLivre.y;
        
        console.log(`🔁 ${jogadorAtingido.nome} respawn em: X=${jogadorAtingido.x}, Y=${jogadorAtingido.y}`);
        
        io.to(this.id).emit("jogadorAtingido", {
          jogadorId: jogadorAtingido.id,
          jogadores: this.jogadores.map(j => ({ 
            id: j.id, 
            vidas: Math.max(0, j.vidas),
            x: j.x,
            y: j.y,
            pontos: Math.max(0, j.pontos)
          }))
        });
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

app.get("/info", (req, res) =>{
  const infoSalas = Array.from(salas.values()).map(sala => ({
    id: sala.id,
    jogadores: sala.jogadores.length,
    jogoAtivo: sala.jogoAtivo,
    campeao: sala.campeao,
    tempoRestante: sala.tempoRestante
  }));
  res.json({ salas: infoSalas });
});

io.on("connection", (socket) => {
  console.log("👤 Novo jogador conectado:", socket.id);
  let salaAtual = null;
  let jogadorAtual = null;

  socket.on("entrarSala", ({ nome, salaId = "default", modo = "jogador" }) => {
    try {
      if (!nome || nome.trim().length === 0) {
        socket.emit("erro", { mensagem: "Nome inválido" });
        return;
      }

      nome = nome.trim().substring(0, 15);
      const modoEspectador = modo === "espectador";

      if (!salas.has(salaId)) {
        salas.set(salaId, new SalaJogo(salaId));
        console.log(`🎮 Nova sala criada: ${salaId}`);
      }

      salaAtual = salas.get(salaId);
      
      if (salaAtual.jogoAtivo && !modoEspectador) {
        socket.emit("erro", { mensagem: "Jogo em andamento. Aguarde o término para entrar." });
        return;
      }
      
      const jogadorExistente = salaAtual.jogadores.find(j => j.id === socket.id);
      if (jogadorExistente && jogadorExistente.vidas <= 0 && !modoEspectador) {
        socket.emit("erro", { mensagem: "Você foi eliminado. Aguarde o próximo jogo." });
        return;
      }
      
      jogadorAtual = salaAtual.jogadores.find(j => j.id === socket.id);
      
      if (!jogadorAtual) {
        jogadorAtual = salaAtual.adicionarJogador(socket.id, nome, modoEspectador);
      }

      socket.join(salaId);
      
      socket.emit("estadoJogo", {
        jogador: jogadorAtual ? {
          id: jogadorAtual.id,
          nome: jogadorAtual.nome,
          pontos: jogadorAtual.pontos,
          x: jogadorAtual.x,
          y: jogadorAtual.y,
          direcao: jogadorAtual.direcao,
          vidas: jogadorAtual.vidas,
          espectador: jogadorAtual.espectador,
          podeEliminar: jogadorAtual.podeEliminar || false,
          tempoPoderEliminar: jogadorAtual.tempoPoderEliminar || 0,
          velocidadeTurbo: jogadorAtual.velocidadeTurbo || false,
          tempoVelocidadeTurbo: jogadorAtual.tempoVelocidadeTurbo || 0
        } : null,
        mapa: salaAtual.mapa,
        fantasmas: salaAtual.fantasmas.map(f => ({
          id: f.id,
          x: f.x,
          y: f.y,
          direcao: f.direcao,
          vulneravel: f.vulneravel,
          cor: f.cor
        })),
        jogadores: salaAtual.jogadores.map(j => ({
          id: j.id,
          nome: j.nome,
          pontos: j.pontos,
          x: j.x,
          y: j.y,
          direcao: j.direcao,
          vidas: j.vidas,
          espectador: j.espectador,
          podeEliminar: j.podeEliminar || false,
          tempoPoderEliminar: j.tempoPoderEliminar || 0,
          velocidadeTurbo: j.velocidadeTurbo || false,
          tempoVelocidadeTurbo: j.tempoVelocidadeTurbo || 0
        })),
        jogoAtivo: salaAtual.jogoAtivo,
        bolinhasRestantes: salaAtual.bolinhasRestantes,
        modoEspectador: modoEspectador,
        tempoRestante: salaAtual.tempoRestante,
        tempoJogo: salaAtual.tempoJogo,
        modoCronometro: salaAtual.modoCronometro
      });

      socket.to(salaId).emit("jogadoresAtualizados", salaAtual.jogadores.map(j => ({
        id: j.id,
        nome: j.nome,
        pontos: j.pontos,
        x: j.x,
        y: j.y,
        direcao: j.direcao,
        vidas: j.vidas,
        espectador: j.espectador,
        podeEliminar: j.podeEliminar || false,
        tempoPoderEliminar: j.tempoPoderEliminar || 0,
        velocidadeTurbo: j.velocidadeTurbo || false,
        tempoVelocidadeTurbo: j.tempoVelocidadeTurbo || 0
      })));

    } catch (error) {
      console.error("Erro ao entrar na sala:", error);
      socket.emit("erro", { mensagem: "Erro interno do servidor" });
    }
  });

  socket.on("movimento", ({ direcao }) => {
    if (!salaAtual || !jogadorAtual || !salaAtual.jogoAtivo || jogadorAtual.espectador) return;
    
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
        fantasmas: salaAtual.fantasmas.map(f => ({
          id: f.id,
          x: f.x,
          y: f.y,
          direcao: f.direcao,
          vulneravel: f.vulneravel,
          cor: f.cor
        })),
        jogadores: salaAtual.jogadores.map(j => ({
          id: j.id,
          nome: j.nome,
          pontos: j.pontos,
          x: j.x,
          y: j.y,
          direcao: j.direcao,
          vidas: j.vidas,
          espectador: j.espectador,
          podeEliminar: j.podeEliminar || false,
          tempoPoderEliminar: j.tempoPoderEliminar || 0,
          velocidadeTurbo: j.velocidadeTurbo || false,
          tempoVelocidadeTurbo: j.tempoVelocidadeTurbo || 0
        })),
        jogoAtivo: true,
        bolinhasRestantes: salaAtual.bolinhasRestantes,
        tempoRestante: salaAtual.tempoRestante,
        tempoJogo: salaAtual.tempoJogo
      });
      
      salaAtual.jogadores.forEach(jogador => {
        io.to(jogador.id).emit("estadoJogador", {
          vidas: Math.max(0, jogador.vidas),
          pontos: Math.max(0, jogador.pontos)
        });
      });
    }
  });

  socket.on("definirTempo", ({ tempoSegundos }) => {
    if (salaAtual) {
      salaAtual.definirTempoJogo(tempoSegundos);
      console.log(`⏰ Tempo definido para ${tempoSegundos} segundos na sala ${salaAtual.id}`);
    }
  });

  socket.on("iniciarCronometro", () => {
    if (salaAtual) {
      salaAtual.iniciarCronometro();
      console.log(`⏰ Cronômetro iniciado na sala ${salaAtual.id}`);
    }
  });

  socket.on("pararCronometro", () => {
    if (salaAtual) {
      salaAtual.pararCronometro();
      console.log(`⏰ Cronômetro parado na sala ${salaAtual.id}`);
    }
  });

  socket.on("disconnect", () => {
    console.log("👋 Jogador desconectado:", socket.id);
    
    if (salaAtual && jogadorAtual) {
      salaAtual.jogadores = salaAtual.jogadores.filter(j => j.id !== socket.id);
      socket.to(salaAtual.id).emit("jogadoresAtualizados", salaAtual.jogadores.map(j => ({
        id: j.id,
        nome: j.nome,
        pontos: j.pontos,
        x: j.x,
        y: j.y,
        direcao: j.direcao,
        vidas: j.vidas,
        espectador: j.espectador,
        podeEliminar: j.podeEliminar || false,
        tempoPoderEliminar: j.tempoPoderEliminar || 0,
        velocidadeTurbo: j.velocidadeTurbo || false,
        tempoVelocidadeTurbo: j.tempoVelocidadeTurbo || 0
      })));
      
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
      sala.jogadores.forEach(jogador => {
        if (jogador.podeEliminar && jogador.tempoPoderEliminar > 0) {
          jogador.tempoPoderEliminar -= 50;
          if (jogador.tempoPoderEliminar <= 0) {
            jogador.podeEliminar = false;
            jogador.tempoPoderEliminar = 0;
            io.to(sala.id).emit("poderEliminarDesativado", {
              jogadorId: jogador.id
            });
          }
        }
        
        if (jogador.velocidadeTurbo && jogador.tempoVelocidadeTurbo > 0) {
          jogador.tempoVelocidadeTurbo -= 50;
          if (jogador.tempoVelocidadeTurbo <= 0) {
            jogador.velocidadeTurbo = false;
            jogador.tempoVelocidadeTurbo = 0;
            io.to(sala.id).emit("velocidadeTurboDesativada", {
              jogadorId: jogador.id
            });
          }
        }
      });

      const jogadoresParaRemover = sala.jogadores.filter(j => j.vidas <= 0 && !j.espectador);
      jogadoresParaRemover.forEach(jogador => {
        sala.jogadores = sala.jogadores.filter(j => j.id !== jogador.id);
        io.to(sala.id).emit("jogadorEliminado", {
          jogadorId: jogador.id,
          jogadorNome: jogador.nome,
          jogadores: sala.jogadores.map(j => ({
            id: j.id,
            nome: j.nome,
            vidas: j.vidas,
            pontos: j.pontos
          }))
        });
      });
      
      sala.jogadores = sala.jogadores.filter(jogador => {
        const socket = io.sockets.sockets.get(jogador.id);
        return socket && socket.connected;
      });
      
      sala.jogadores.forEach(jogador => {
        jogador.vidas = Math.max(0, jogador.vidas);
        jogador.pontos = Math.max(0, jogador.pontos);
      });
      
      const jogadoresAtivos = sala.jogadores.filter(j => !j.espectador);
      if (jogadoresAtivos.length === 0) {
        sala.jogoAtivo = false;
        return;
      }
      
      sala.jogadores.forEach(jogador => {
        if (jogador.espectador) return;
        
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
      
      sala.fantasmas.forEach(fantasma => {
        sala.moverFantasma(fantasma);
      });
      
      io.to(sala.id).emit("estadoAtualizado", {
        jogadores: sala.jogadores.map(j => ({
          id: j.id,
          nome: j.nome,
          x: j.x,
          y: j.y,
          direcao: j.direcao,
          vidas: Math.max(0, j.vidas),
          pontos: Math.max(0, j.pontos),
          espectador: j.espectador || false,
          podeEliminar: j.podeEliminar || false,
          tempoPoderEliminar: j.tempoPoderEliminar || 0,
          velocidadeTurbo: j.velocidadeTurbo || false,
          tempoVelocidadeTurbo: j.tempoVelocidadeTurbo || 0
        })),
        fantasmas: sala.fantasmas.map(f => ({
          id: f.id,
          x: f.x,
          y: f.y,
          direcao: f.direcao,
          vulneravel: f.vulneravel,
          cor: f.cor
        })),
        bolinhasRestantes: sala.bolinhasRestantes
      });

      console.log(`🎮 Sala ${sala.id}: ${sala.jogadores.length} jogadores (${jogadoresAtivos.length} ativos), Tempo: ${sala.tempoRestante}s`);
    }
  });
}, CONFIG.UPDATE_INTERVAL);

server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`🎯 Velocidade Pac-Man: ${CONFIG.VELOCIDADE_PACMAN}px/frame`);
  console.log(`⚡ Velocidade Turbo: ${CONFIG.VELOCIDADE_PACMAN_TURBO}px/frame`);
  console.log(`👻 Velocidade Fantasmas: ${CONFIG.VELOCIDADE_FANTASMA_NORMAL}px/frame`);
  console.log(`📊 FPS: ${Math.round(1000/CONFIG.UPDATE_INTERVAL)}`);
  console.log(`⏰ Tempo padrão: ${CONFIG.TEMPO_PADRAO} segundos`);
  console.log(`🍒 Frutas spawnam a cada: ${CONFIG.SPAWN_FRUTA_INTERVALO/1000} segundos`);
  console.log(`⚡ Poder de eliminar: ${CONFIG.DURACAO_PODER_ELIMINAR/1000} segundos`);
  console.log(`🏃 Velocidade turbo: ${CONFIG.DURACAO_VELOCIDADE_TURBO/1000} segundos`);
  console.log(`💀 Sistema de eliminação ativado`);
  console.log(`👀 Modo espectador disponível`);
});