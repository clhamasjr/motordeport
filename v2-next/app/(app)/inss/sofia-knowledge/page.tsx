'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { useListKnowledge, useAddKnowledge, useUpdateKnowledge, type KnowledgeItem } from '@/hooks/use-inss-evolution';
import { Brain, Plus, Edit2, Power, AlertCircle, Search } from 'lucide-react';

const CATEGORIAS = [
  'empresa', 'produto_portabilidade', 'produto_emprestimo_novo',
  'produto_cartao', 'produto_saque', 'regulacao', 'objecao', 'escalacao', 'outros',
];

const COR_CAT: Record<string, string> = {
  empresa: 'text-cyan-400',
  produto_portabilidade: 'text-purple-400',
  produto_emprestimo_novo: 'text-green-400',
  produto_cartao: 'text-yellow-400',
  produto_saque: 'text-orange-400',
  regulacao: 'text-red-400',
  objecao: 'text-blue-400',
  escalacao: 'text-red-500',
  outros: 'text-muted-foreground',
};

export default function SofiaKnowledgePage() {
  const { data: items = [], isLoading, error } = useListKnowledge();
  const add = useAddKnowledge();
  const update = useUpdateKnowledge();
  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<KnowledgeItem | null>(null);

  const filtered = useMemo(() => {
    let arr = items;
    if (categoria) arr = arr.filter((k) => k.categoria === categoria);
    if (busca) {
      const q = busca.toLowerCase();
      arr = arr.filter(
        (k) =>
          k.topico.toLowerCase().includes(q) ||
          k.conteudo.toLowerCase().includes(q),
      );
    }
    return [...arr].sort((a, b) => {
      const c = a.categoria.localeCompare(b.categoria);
      if (c !== 0) return c;
      return (b.prioridade || 0) - (a.prioridade || 0);
    });
  }, [items, busca, categoria]);

  const byCat = useMemo(() => {
    const acc: Record<string, KnowledgeItem[]> = {};
    for (const k of filtered) {
      if (!acc[k.categoria]) acc[k.categoria] = [];
      acc[k.categoria].push(k);
    }
    return acc;
  }, [filtered]);

  const openCreate = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (k: KnowledgeItem) => { setEditing(k); setModalOpen(true); };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="size-6 text-purple-400" />
            Sofia — Knowledge Base
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Afirmações que a Sofia usa pra responder cliente. Edite aqui sem mexer no código.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="size-4" />
          Nova afirmação
        </Button>
      </div>

      <Card>
        <CardContent className="p-3 flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[200px]">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Buscar
            </Label>
            <div className="relative mt-1">
              <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="tópico ou conteúdo..." value={busca} onChange={(e) => setBusca(e.target.value)} className="pl-8" />
            </div>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Categoria
            </Label>
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              className="mt-1 h-10 rounded-md border border-input bg-background px-3 text-sm block"
            >
              <option value="">Todas</option>
              {CATEGORIAS.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      )}

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="p-3 flex items-center gap-2 text-destructive">
            <AlertCircle className="size-4" /> {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <Brain className="size-12 mx-auto mb-2 opacity-30" />
            <div className="text-sm">Nenhuma afirmação cadastrada.</div>
          </CardContent>
        </Card>
      )}

      {Object.entries(byCat).map(([cat, ks]) => (
        <Card key={cat}>
          <CardContent className="p-3">
            <div className={`text-[10px] uppercase tracking-wider font-bold mb-2 ${COR_CAT[cat] || ''}`}>
              {cat.replace(/_/g, ' ')} ({ks.length})
            </div>
            <div className="space-y-1.5">
              {ks.map((k) => {
                const cor = COR_CAT[k.categoria] || 'text-muted-foreground';
                return (
                  <div
                    key={k.id}
                    className={`flex items-start gap-2 p-2 rounded-md bg-card/50 border border-border ${
                      !k.ativo ? 'opacity-40' : ''
                    }`}
                    style={{ borderLeftWidth: 3, borderLeftColor: 'currentColor' }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] flex items-center gap-2">
                        <span className={`font-bold ${cor}`}>[{k.topico}]</span>
                        <span className="text-muted-foreground">prio: {k.prioridade || 0}</span>
                        {!k.ativo && <Badge variant="muted" className="text-[9px]">inativo</Badge>}
                      </div>
                      <div className="text-xs mt-0.5">{k.conteudo}</div>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(k)}>
                        <Edit2 className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => update.mutate({ id: k.id, ativo: !k.ativo })}
                      >
                        <Power className={`size-3.5 ${k.ativo ? 'text-yellow-400' : 'text-green-400'}`} />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}

      <KnowledgeModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editing={editing}
        onSave={async (data) => {
          if (editing) await update.mutateAsync({ id: editing.id, ...data });
          else await add.mutateAsync(data);
          setModalOpen(false);
        }}
      />
    </div>
  );
}

function KnowledgeModal({
  open, onClose, editing, onSave,
}: {
  open: boolean;
  onClose: () => void;
  editing: KnowledgeItem | null;
  onSave: (k: Omit<KnowledgeItem, 'id'>) => Promise<void>;
}) {
  const [categoria, setCategoria] = useState(editing?.categoria || 'empresa');
  const [topico, setTopico] = useState(editing?.topico || '');
  const [conteudo, setConteudo] = useState(editing?.conteudo || '');
  const [prioridade, setPrioridade] = useState(editing?.prioridade || 50);

  const handleOpen = (o: boolean) => {
    if (o) {
      setCategoria(editing?.categoria || 'empresa');
      setTopico(editing?.topico || '');
      setConteudo(editing?.conteudo || '');
      setPrioridade(editing?.prioridade || 50);
    } else {
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Editar afirmação #${editing.id}` : 'Nova afirmação'}</DialogTitle>
          <DialogDescription>
            Afirmação direta — sem formato pergunta/resposta. Ex: &quot;A FACTA pratica taxa de 1.50% ao mês.&quot;
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!topico.trim() || !conteudo.trim()) return;
            await onSave({ categoria, topico: topico.trim(), conteudo: conteudo.trim(), prioridade, ativo: true });
          }}
          className="space-y-3"
        >
          <div>
            <Label>Categoria</Label>
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {CATEGORIAS.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <Label>Tópico</Label>
            <Input value={topico} onChange={(e) => setTopico(e.target.value)} placeholder="ex: taxa_portabilidade" required />
          </div>
          <div>
            <Label>Afirmação</Label>
            <textarea
              value={conteudo}
              onChange={(e) => setConteudo(e.target.value)}
              rows={4}
              required
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="ex: A FACTA pratica taxa de port INSS a partir de 1.50% ao mês..."
            />
          </div>
          <div>
            <Label>Prioridade (0-100, maior = mais peso no prompt)</Label>
            <Input type="number" min={0} max={100} value={prioridade} onChange={(e) => setPrioridade(parseInt(e.target.value) || 50)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit">{editing ? 'Salvar' : 'Criar'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
