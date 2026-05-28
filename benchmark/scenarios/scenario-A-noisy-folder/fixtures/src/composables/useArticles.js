import { ref } from 'vue';

// Aurora-CMS convention: every API call goes through a useXxx composable.
// Components MUST NOT call fetch directly.
export function useArticles() {
  const data = ref([]);
  const error = ref(null);
  const loading = ref(false);
  const nextCursor = ref(null);
  const hasMore = ref(false);

  const refresh = async (cursor = null) => {
    loading.value = true;
    error.value = null;
    try {
      const qs = new URLSearchParams();
      if (cursor) qs.set('cursor', cursor);
      qs.set('limit', '25');
      const res = await fetch(`/articles?${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      data.value = cursor ? [...data.value, ...body.data] : body.data;
      nextCursor.value = body.next_cursor;
      hasMore.value = body.has_more;
    } catch (e) {
      error.value = e;
    } finally {
      loading.value = false;
    }
  };

  const loadMore = () => hasMore.value && refresh(nextCursor.value);

  return { data, error, loading, hasMore, nextCursor, refresh, loadMore };
}
