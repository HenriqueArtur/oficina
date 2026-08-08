import { describe, expect, test } from "bun:test";
import {
  CHAVES_DE_COR,
  type ChaveDeCor,
  cssDosTemas,
  FONTES,
  TEMA_PADRAO,
  TEMAS,
} from "./themes.ts";

describe("catálogo de temas", () => {
  test("tem pelo menos 12, como pedido", () => {
    expect(TEMAS.length).toBeGreaterThanOrEqual(12);
  });

  test("o padrão é o tema que já estava no ar", () => {
    expect(TEMA_PADRAO).toBe("papel");
    expect(TEMAS.find((t) => t.id === TEMA_PADRAO)).toBeTruthy();
  });

  test("todo tema declara TODAS as variáveis de cor", () => {
    for (const tema of TEMAS) {
      for (const chave of CHAVES_DE_COR) {
        // faltar uma faz o tema herdar a cor do anterior em silêncio,
        // que é pior que um tema feio
        expect(tema.cores[chave], `${tema.id} → ${chave}`).toBeTruthy();
      }
    }
  });

  test("nenhuma variável a mais, para não haver cor morta", () => {
    for (const tema of TEMAS) {
      for (const chave of Object.keys(tema.cores)) {
        expect([...CHAVES_DE_COR] as string[], `${tema.id} → ${chave}`).toContain(chave);
      }
    }
  });

  test("toda cor é hex de 6 dígitos", () => {
    for (const tema of TEMAS) {
      for (const [chave, valor] of Object.entries(tema.cores) as [ChaveDeCor, string][]) {
        expect(valor, `${tema.id} → ${chave}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  test("id é kebab-case, para virar seletor CSS sem escape", () => {
    for (const t of TEMAS) expect(t.id, t.id).toMatch(/^[a-z0-9-]+$/);
  });

  test("nenhum id repetido", () => {
    const ids = TEMAS.map((t) => t.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  test("todo tema diz se é claro ou escuro", () => {
    for (const t of TEMAS) expect(["claro", "escuro"], t.id).toContain(t.brilho);
  });

  test("tem tema claro e tema escuro de sobra", () => {
    expect(TEMAS.filter((t) => t.brilho === "claro").length).toBeGreaterThanOrEqual(4);
    expect(TEMAS.filter((t) => t.brilho === "escuro").length).toBeGreaterThanOrEqual(6);
  });

  test("os clássicos que pedi estão lá", () => {
    const ids = TEMAS.map((t) => t.id);
    for (const esperado of ["dracula", "nord", "gruvbox-escuro", "tokyo-night", "one-dark"]) {
      expect(ids, esperado).toContain(esperado);
    }
    expect(ids.some((i) => i.startsWith("catppuccin"))).toBe(true);
    expect(ids.some((i) => i.startsWith("solarized"))).toBe(true);
  });
});

describe("contraste mínimo", () => {
  // texto sobre fundo precisa ser legível; um tema bonito e ilegível não serve
  const luminancia = (hex: string) => {
    const canal = (i: number) => {
      const v = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2);
  };
  const razao = (a: string, b: string) => {
    const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
    return (x! + 0.05) / (y! + 0.05);
  };

  test("texto sobre fundo passa de 4.5:1 (WCAG AA) em todo tema", () => {
    // 4.5 é o piso de legibilidade para texto corrido. Não subo para 7 (AAA)
    // porque as paletas famosas não miram AAA — o Rosé Pine Dawn oficial dá
    // 6.66 — e prefiro a paleta fiel a uma cor que eu inventei.
    for (const t of TEMAS) {
      expect(razao(t.cores.texto, t.cores.fundo), t.id).toBeGreaterThan(4.5);
    }
  });

  test("o tema padrão, que é o mais usado, passa de 7:1 (AAA)", () => {
    const padrao = TEMAS.find((t) => t.id === TEMA_PADRAO)!;
    expect(razao(padrao.cores.texto, padrao.cores.fundo)).toBeGreaterThan(7);
  });

  test("texto suave ainda passa de 4.5:1", () => {
    for (const t of TEMAS) {
      expect(razao(t.cores.suave, t.cores.fundo), t.id).toBeGreaterThan(4.5);
    }
  });

  test("o destaque se separa do fundo", () => {
    for (const t of TEMAS) {
      expect(razao(t.cores.destaque, t.cores.fundo), t.id).toBeGreaterThan(3);
    }
  });

  test("comentário de código é legível sobre o fundo de código", () => {
    for (const t of TEMAS) {
      expect(razao(t.cores["cod-comentario"], t.cores.codigo), t.id).toBeGreaterThan(3);
    }
  });
});

describe("fontes", () => {
  test("tem serifada, que é a preferida para leitura", () => {
    expect(FONTES.map((f) => f.id)).toContain("serifada");
  });

  test("tem pelo menos três opções", () => {
    expect(FONTES.length).toBeGreaterThanOrEqual(3);
  });

  test("toda fonte termina com uma família genérica, para nunca ficar sem", () => {
    for (const f of FONTES) {
      expect(f.pilha, f.id).toMatch(/(serif|sans-serif|monospace)\s*$/);
    }
  });

  test("id kebab-case e sem repetição", () => {
    const ids = FONTES.map((f) => f.id);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
    expect(ids.length).toBe(new Set(ids).size);
  });
});

describe("cssDosTemas", () => {
  const css = cssDosTemas();

  test("gera um bloco por tema, endereçado pelo data-tema", () => {
    for (const t of TEMAS) {
      expect(css, t.id).toContain(`[data-tema="${t.id}"]`);
    }
  });

  test("o padrão também vale sem data-tema nenhum", () => {
    expect(css).toContain(":root");
  });

  test("declara cada variável com o prefixo certo", () => {
    for (const chave of CHAVES_DE_COR) {
      expect(css, chave).toContain(`--${chave}:`);
    }
  });

  test("gera as pilhas de fonte", () => {
    for (const f of FONTES) {
      expect(css, f.id).toContain(`[data-fonte="${f.id}"]`);
    }
  });
});
