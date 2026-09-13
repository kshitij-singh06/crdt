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
  /** Opens the card detail modal for a given card. */
  onOpenDetail: (cardId: string) => void;
  /**
   * Map of cardId → name of the remote user currently editing that card's
   * title (from Awareness). Used to show the editing indicator chip.
   */
  editingByUser: Record<string, string>;
  /** When false, the "Add card" form is hidden (viewer role). */
  canEdit?: boolean;
  /** Awareness: called when this user starts inline-editing a card title. */
  onEditingStart?: (cardId: string) => void;
  /** Awareness: called when this user stops inline-editing a card title. */
  onEditingEnd?: () => void;
  /** Map of cardId → array of comments, used to show comment count badges. */
  commentsByCard?: Record<string, unknown[]>;
}

export default function BoardColumn({
  columnId,
  title,
  cardIds,
  cards,
  onTitleChange,
  onAddCard,
  activeCardId,
  onOpenDetail,
  editingByUser,
  canEdit = true,
  onEditingStart,
  onEditingEnd,
  commentsByCard,
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
                onOpenDetail={() => onOpenDetail(cardId)}
                editingUser={editingByUser[cardId] ?? null}
                onEditingStart={onEditingStart}
                onEditingEnd={onEditingEnd}
                commentCount={(commentsByCard?.[cardId] ?? []).length}
              />
            );
          })}
        </SortableContext>

        {cardIds.length === 0 && (
          <div className="column-empty">
            Drop cards here
          </div>
        )}
      </div>

      {canEdit && <AddCardForm columnId={columnId} onAdd={onAddCard} />}
    </div>
  );
}
