import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import KanbanCard from "./KanbanCard";
import AddCardForm from "./AddCardForm";

interface CardData {
  id: string;
  columnId: string;
  title: string;
  description: string;
  assigneeId: string | null;
}

interface BoardColumnProps {
  columnId: string;
  title: string;
  cardIds: string[];
  cards: Record<string, CardData>;
  onTitleChange: (cardId: string, newTitle: string) => void;
  onAddCard: (columnId: string, title: string) => void;
  activeCardId: string | null;
}

export default function BoardColumn({
  columnId,
  title,
  cardIds,
  cards,
  onTitleChange,
  onAddCard,
  activeCardId,
}: BoardColumnProps) {
  // Make the column itself a drop target so cards can be dropped into empty columns
  const { setNodeRef, isOver } = useDroppable({ id: columnId });

  return (
    <div
      className={`board-column ${isOver ? "board-column--over" : ""}`}
      data-column-id={columnId}
    >
      <div className="column-header">
        <h2 className="column-title">{title}</h2>
        <span className="column-card-count">{cardIds.length}</span>
      </div>

      <div ref={setNodeRef} className="column-cards">
        <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
          {cardIds.map((cardId) => {
            const card = cards[cardId];
            if (!card) return null;
            return (
              <KanbanCard
                key={cardId}
                id={cardId}
                title={card.title}
                onTitleChange={(newTitle) => onTitleChange(cardId, newTitle)}
                isDragging={activeCardId === cardId}
              />
            );
          })}
        </SortableContext>

        {cardIds.length === 0 && (
          <div className="column-empty">Drop cards here</div>
        )}
      </div>

      <AddCardForm columnId={columnId} onAdd={onAddCard} />
    </div>
  );
}
