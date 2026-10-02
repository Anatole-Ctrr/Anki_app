"""
Modèles orientés objet représentant les entités Anki : Paquets, Notes, Cartes et Modèles.
"""

from dataclasses import dataclass, field
import html
import re
from typing import Any, Dict, List, Optional


@dataclass
class NoteModel:
    """Modèle de note (Note Type) définissant les champs et les templates de cartes."""
    id: int
    name: str
    is_cloze: bool = False
    css: str = ""
    fields_names: List[str] = field(default_factory=list)
    templates: List[Dict[str, Any]] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "NoteModel":
        fields_names = [f["name"] for f in sorted(data.get("flds", []), key=lambda x: x.get("ord", 0))]
        templates = sorted(data.get("tmpls", []), key=lambda x: x.get("ord", 0))
        is_cloze = data.get("type", 0) == 1
        return cls(
            id=int(data["id"]),
            name=data.get("name", "Standard"),
            is_cloze=is_cloze,
            css=data.get("css", ""),
            fields_names=fields_names,
            templates=templates,
        )


@dataclass
class Note:
    """Représente une note contenant les données brutes saisies par l'utilisateur."""
    id: int
    guid: str
    model_id: int
    raw_fields: List[str]
    tags: List[str] = field(default_factory=list)
    field_dict: Dict[str, str] = field(default_factory=dict)

    def bind_model(self, model: NoteModel) -> None:
        """Associe les valeurs de champs aux noms de champs du modèle."""
        self.field_dict = {}
        for i, name in enumerate(model.fields_names):
            if i < len(self.raw_fields):
                self.field_dict[name] = self.raw_fields[i]
            else:
                self.field_dict[name] = ""


@dataclass
class Card:
    """Représente une carte générée à partir d'une note selon un template ordinal."""
    id: int
    note_id: int
    deck_id: int
    ord: int
    type: int = 0
    queue: int = 0
    due: int = 0
    reps: int = 0
    lapses: int = 0
    note: Optional[Note] = None

    def render_question(self, model: NoteModel) -> str:
        """Génère le rendu HTML du recto de la carte."""
        if not self.note:
            return ""

        if model.is_cloze:
            template = model.templates[0] if model.templates else {"qfmt": "{{cloze:Text}}"}
            qfmt = template.get("qfmt", "{{cloze:Text}}")
            return self._render_template(qfmt, model, is_answer=False)

        if self.ord < len(model.templates):
            qfmt = model.templates[self.ord].get("qfmt", "")
            return self._render_template(qfmt, model, is_answer=False)

        return ""

    def render_answer(self, model: NoteModel) -> str:
        """Génère le rendu HTML du verso de la carte."""
        if not self.note:
            return ""

        if model.is_cloze:
            template = model.templates[0] if model.templates else {"afmt": "{{cloze:Text}}"}
            afmt = template.get("afmt", "{{cloze:Text}}")
            front = self.render_question(model)
            return self._render_template(afmt, model, is_answer=True, front_side=front)

        if self.ord < len(model.templates):
            afmt = model.templates[self.ord].get("afmt", "")
            front = self.render_question(model)
            return self._render_template(afmt, model, is_answer=True, front_side=front)

        return ""

    def _render_template(
        self,
        template_str: str,
        model: NoteModel,
        is_answer: bool = False,
        front_side: str = "",
    ) -> str:
        output = template_str

        # Remplacement de {{FrontSide}} au verso
        if is_answer:
            # Anki enlève les balises audio dans FrontSide pour éviter les doublons sonores
            front_clean = re.sub(r"\[sound:[^\]]+\]", "", front_side)
            output = output.replace("{{FrontSide}}", front_clean)

        fields = self.note.field_dict if self.note else {}

        # 1. Conditionnels positifs: {{#Field}}...{{/Field}}
        def cond_replace(match):
            field_name = match.group(1).strip()
            content = match.group(2)
            val = fields.get(field_name, "").strip()
            return content if val else ""

        output = re.sub(r"\{\{#([^}]+)\}\}(.*?)\{\{/\1\}\}", cond_replace, output, flags=re.DOTALL)

        # 2. Conditionnels négatifs: {{^Field}}...{{/Field}}
        def neg_cond_replace(match):
            field_name = match.group(1).strip()
            content = match.group(2)
            val = fields.get(field_name, "").strip()
            return "" if val else content

        output = re.sub(r"\{\{\^([^}]+)\}\}(.*?)\{\{/\1\}\}", neg_cond_replace, output, flags=re.DOTALL)

        # 3. Remplacement des Clozes si modèle de type Cloze
        if model.is_cloze:
            cloze_idx = self.ord + 1
            output = self._process_cloze_modifiers(output, fields, cloze_idx, is_answer)

        # 4. Remplacement direct des variables {{Field}}
        for fname, fval in fields.items():
            pattern = re.compile(r"\{\{" + re.escape(fname) + r"\}\}", re.IGNORECASE)
            output = pattern.sub(lambda _: fval, output)

        return output

    def _process_cloze_modifiers(
        self, text: str, fields: Dict[str, str], cloze_idx: int, is_answer: bool
    ) -> str:
        """Remplace {{cloze:FieldName}} selon l'indice cloze et si c'est la question ou la réponse."""
        def cloze_filter(match):
            field_name = match.group(1).strip()
            val = fields.get(field_name, "")
            return self._format_cloze(val, cloze_idx, is_answer)

        return re.sub(r"\{\{cloze:([^}]+)\}\}", cloze_filter, text, flags=re.IGNORECASE)

    def _format_cloze(self, text: str, target_idx: int, is_answer: bool) -> str:
        """Transforme {{cN::texte::indice}} en zone masquée [...] ou révélée."""
        def repl(m):
            c_num = int(m.group(1))
            answer = m.group(2)
            hint = m.group(3) if m.group(3) else None

            if c_num == target_idx:
                if is_answer:
                    return f'<span class="cloze">{answer}</span>'
                else:
                    placeholder = f"[{hint}]" if hint else "[...]"
                    return f'<span class="cloze">{placeholder}</span>'
            else:
                # Les autres indices cloze restent en clair
                return answer

        return re.sub(r"\{\{c(\d+)::(.*?)(?:::([^}]*))?\}\}", repl, text)


@dataclass
class Deck:
    """Représente un paquet de cartes Anki."""
    id: int
    name: str
    cards: List[Card] = field(default_factory=list)

    @property
    def total_cards(self) -> int:
        return len(self.cards)
