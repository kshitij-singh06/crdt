import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getInvite, acceptInvite } from "../api/boards";
import type { InviteDetail } from "../api/boards";

export default function InvitePage() {
  const { token: inviteToken } = useParams<{ token: string }>();
  const { token: authToken, user } = useAuth();
  const navigate = useNavigate();

  const [invite, setInvite] = useState<InviteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  useEffect(() => {
    if (!authToken || !inviteToken) return;
    setLoading(true);
    getInvite(inviteToken, authToken)
      .then((data) => {
        setInvite(data.invite);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load invite");
      })
      .finally(() => setLoading(false));
  }, [inviteToken, authToken]);

  async function handleAccept() {
    if (!authToken || !inviteToken) return;
    setAccepting(true);
    setAcceptError(null);
    try {
      const result = await acceptInvite(inviteToken, authToken);
      navigate(`/board/${result.boardId}`);
    } catch (err: unknown) {
      setAcceptError(err instanceof Error ? err.message : "Failed to accept invite");
    } finally {
      setAccepting(false);
    }
  }

  if (loading) {
    return (
      <div className="invite-page">
        <div className="invite-card">
          <div className="spinner" />
          <p>Loading invite…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="invite-page">
        <div className="invite-card">
          <h2>Invite Error</h2>
          <p className="form-error">{error}</p>
          <Link to="/boards" className="btn-ghost">← Back to boards</Link>
        </div>
      </div>
    );
  }

  if (!invite) return null;

  const alreadyAccepted = !!invite.accepted_at;
  const emailMismatch = user?.email !== invite.email;

  return (
    <div className="invite-page">
      <div className="invite-card">
        <div className="invite-icon">✉️</div>
        <h2>Board Invitation</h2>
        <p className="invite-board-name">
          You've been invited to join <strong>{invite.board_name}</strong>
        </p>
        <div className="invite-details">
          <div className="invite-detail-row">
            <span className="invite-detail-label">Role</span>
            <span className={`member-role member-role--${invite.role}`}>
              {invite.role}
            </span>
          </div>
          <div className="invite-detail-row">
            <span className="invite-detail-label">Invited email</span>
            <span className="invite-detail-value">{invite.email}</span>
          </div>
        </div>

        {alreadyAccepted && (
          <div className="invite-accepted-msg">
            <p>✅ This invite has already been accepted.</p>
            <Link to={`/board/${invite.board_id}`} className="btn-primary">
              Go to Board →
            </Link>
          </div>
        )}

        {!alreadyAccepted && emailMismatch && (
          <div className="invite-mismatch-msg">
            <p className="form-error">
              This invite was sent to <strong>{invite.email}</strong>, but you're
              logged in as <strong>{user?.email}</strong>.
            </p>
            <p>Please log in with the correct account to accept.</p>
          </div>
        )}

        {!alreadyAccepted && !emailMismatch && (
          <>
            <button
              id="accept-invite-btn"
              className="btn-primary invite-accept-btn"
              onClick={handleAccept}
              disabled={accepting}
            >
              {accepting ? "Accepting…" : "Accept Invite"}
            </button>
            {acceptError && <p className="form-error">{acceptError}</p>}
          </>
        )}

        <Link to="/boards" className="invite-back-link">← Back to boards</Link>
      </div>
    </div>
  );
}
