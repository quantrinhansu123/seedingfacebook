import type { StoredPostComment } from '@/lib/types';
import { socialAuthorProfileUrl } from '@/lib/utils';

type Row = Pick<StoredPostComment, 'author_id' | 'author_name' | 'source'>;

export function CommentAuthorLink({
  row,
  className = 'stored-comment-author-link',
}: {
  row: Row;
  className?: string;
}) {
  const name = row.author_name || 'Ẩn danh';
  const href = socialAuthorProfileUrl(row);
  if (!href) return <b>{name}</b>;
  return (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      <b>{name}</b>
    </a>
  );
}

export function CommentAuthorHeading({ row }: { row: Row }) {
  const name = row.author_name || 'Ẩn danh';
  const href = socialAuthorProfileUrl(row);
  if (!href) return <h2>{name}</h2>;
  return (
    <h2>
      <a className="omni-author-link" href={href} target="_blank" rel="noopener noreferrer">
        {name}
      </a>
    </h2>
  );
}
