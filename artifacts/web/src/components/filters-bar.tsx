const sorts: { value: string; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "rating", label: "Top rated" },
  { value: "popular", label: "Most popular" },
  { value: "title", label: "Title, A–Z" },
];

export function FiltersBar({
  genres,
  current,
}: {
  genres: string[];
  current: {
    query?: string;
    type?: string;
    genre?: string;
    sort?: string;
  };
}) {
  return (
    <form
      action="/browse"
      method="get"
      className="rule-b flex flex-wrap items-end gap-x-8 gap-y-4 pb-6"
    >
      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-muted-dim">
        Search
        <input
          type="search"
          name="query"
          defaultValue={current.query}
          placeholder="Title or synopsis"
          className="w-48 border-b border-line bg-transparent py-1 text-sm text-text focus:border-marquee focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-muted-dim">
        Type
        <select
          name="type"
          defaultValue={current.type ?? ""}
          className="border-b border-line bg-transparent py-1 text-sm text-text focus:border-marquee focus:outline-none"
        >
          <option value="">All</option>
          <option value="movie">Films</option>
          <option value="series">Series</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-muted-dim">
        Genre
        <select
          name="genre"
          defaultValue={current.genre ?? ""}
          className="border-b border-line bg-transparent py-1 text-sm text-text focus:border-marquee focus:outline-none"
        >
          <option value="">All</option>
          {genres.map((genre) => (
            <option key={genre} value={genre}>
              {genre}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-muted-dim">
        Sort
        <select
          name="sort"
          defaultValue={current.sort ?? "newest"}
          className="border-b border-line bg-transparent py-1 text-sm text-text focus:border-marquee focus:outline-none"
        >
          {sorts.map((sort) => (
            <option key={sort.value} value={sort.value}>
              {sort.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        className="border-b border-marquee pb-1 text-sm text-marquee hover:text-paper"
      >
        Apply
      </button>
    </form>
  );
}
