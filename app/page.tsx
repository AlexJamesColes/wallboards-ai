import BrowsePage from './_browse/BrowsePage';

export const dynamic = 'force-dynamic';

/**
 * Public landing — lists every wallboard, grouped by display type
 * (Mobile / Desktop). Phones default to the Mobile tab, larger screens
 * default to Desktop. Anyone with the URL can pick a board to open;
 * no admin login required.
 */
export default function Home() {
  return <BrowsePage />;
}
