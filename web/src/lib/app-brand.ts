export type AppEdition = 'seeding' | 'sale';

const edition: AppEdition =
  process.env.NEXT_PUBLIC_APP_EDITION?.trim().toLowerCase() === 'sale'
    ? 'sale'
    : 'seeding';

const brands = {
  seeding: {
    edition: 'seeding' as const,
    name: 'Seeding Fsolution',
    railPrimary: 'Seeding',
    railSecondary: 'Fsolution',
    authTitle: 'Quản lý bình luận và chăm sóc khách hàng đa kênh',
    authDescription:
      'Theo dõi bài viết, lọc comment Facebook/TikTok, lưu lịch sử sale và hỗ trợ AI tóm tắt trong một màn hình vận hành.',
    homeDescription: 'Chọn module để vận hành hệ thống social console.',
    metaDescription: 'Theo dõi bài viết, lọc bình luận và quản lý sale đa kênh',
  },
  sale: {
    edition: 'sale' as const,
    name: 'Sale F-Solution',
    railPrimary: 'Sale',
    railSecondary: 'F-Solution',
    authTitle: 'Quản lý khách hàng và vận hành Sale đa kênh',
    authDescription:
      'Theo dõi khách hàng, xử lý bình luận Facebook/TikTok, lưu lịch sử tư vấn và quản lý hiệu suất Sale trong một màn hình.',
    homeDescription: 'Chọn module để vận hành hệ thống Sale F-Solution.',
    metaDescription: 'Quản lý khách hàng và vận hành Sale đa kênh của F-Solution',
  },
};

export const APP_BRAND = brands[edition];
