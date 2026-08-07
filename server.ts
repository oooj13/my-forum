import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

export interface CommentItem {
  id: string;
  postId: string;
  parentId: string | null;
  author: string;
  passwordHash: string; // Plain password for simple demo or stored value
  content: string;
  createdAt: string;
  likes: number;
}

export interface PostItem {
  id: string;
  title: string;
  content: string;
  author: string;
  passwordHash: string;
  category: '공지' | '일반' | '질문';
  createdAt: string;
  updatedAt?: string;
  views: number;
  likes: number;
  isPinned?: boolean;
  tags?: string[];
}

// In-Memory Database Store
const posts: PostItem[] = [
  {
    id: "post-1",
    title: "📢 게시판 규칙",
    content: "욕설이나 비하발언 노노",
    author: "운영자",
    passwordHash: "1234",
    category: "공지",
    createdAt: new Date().toISOString(),
    views: 0,
    likes: 0,
    isPinned: true, 
    tags: ["공지사항", "이용수칙", "가이드"]
  }
];

const comments: CommentItem[] = [];

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // --- REST API ENDPOINTS ---

  // 1. Get all posts with filtering, searching, sorting, and pagination
  app.get("/api/posts", (req, res) => {
    try {
      const { category, search, sortBy = "latest", page = "1", limit = "10" } = req.query;

      let filtered = [...posts];

      // Category filter
      if (category && category !== "전체") {
        filtered = filtered.filter(p => p.category === category);
      }

      // Search filter
      if (search && typeof search === "string" && search.trim() !== "") {
        const query = search.trim().toLowerCase();
        filtered = filtered.filter(
          p =>
            p.title.toLowerCase().includes(query) ||
            p.content.toLowerCase().includes(query) ||
            p.author.toLowerCase().includes(query) ||
            (p.tags && p.tags.some(t => t.toLowerCase().includes(query)))
        );
      }

      // Sorting
      filtered.sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;

        if (sortBy === "views") {
          return b.views - a.views;
        } else if (sortBy === "likes") {
          return b.likes - a.likes;
        } else if (sortBy === "comments") {
          const aComments = comments.filter(c => c.postId === a.id).length;
          const bComments = comments.filter(c => c.postId === b.id).length;
          return bComments - aComments;
        } else {
          // latest (default)
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }
      });

      // Pagination
      const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
      const limitNum = Math.max(1, parseInt(limit as string, 10) || 10);
      const total = filtered.length;
      const totalPages = Math.ceil(total / limitNum) || 1;
      const startIndex = (pageNum - 1) * limitNum;
      const paginatedPosts = filtered.slice(startIndex, startIndex + limitNum);

      // Map to include comment count
      const resultPosts = paginatedPosts.map(p => ({
        id: p.id,
        title: p.title,
        content: p.content,
        author: p.author,
        category: p.category,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        views: p.views,
        likes: p.likes,
        isPinned: p.isPinned,
        tags: p.tags,
        commentCount: comments.filter(c => c.postId === p.id).length
      }));

      res.json({
        success: true,
        data: resultPosts,
        total,
        page: pageNum,
        totalPages
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류가 발생했습니다." });
    }
  });

  // 2. Get single post & increment view count
  app.get("/api/posts/:id", (req, res) => {
    try {
      const { id } = req.params;
      const post = posts.find(p => p.id === id);

      if (!post) {
        return res.status(404).json({ success: false, message: "게시글을 찾을 수 없습니다." });
      }

      // Increment view count
      post.views += 1;

      // Get post comments
      const postComments = comments
        .filter(c => c.postId === id)
        .map(({ passwordHash, ...rest }) => rest);

      res.json({
        success: true,
        data: {
          id: post.id,
          title: post.title,
          content: post.content,
          author: post.author,
          category: post.category,
          createdAt: post.createdAt,
          updatedAt: post.updatedAt,
          views: post.views,
          likes: post.likes,
          isPinned: post.isPinned,
          tags: post.tags,
          commentCount: postComments.length,
          comments: postComments
        }
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류가 발생했습니다." });
    }
  });

  // 3. Create a new post
  app.post("/api/posts", (req, res) => {
    try {
      const { title, content, author, password, category, tags } = req.body;

      if (!title || !content || !author || !password) {
        return res.status(400).json({ success: false, message: "모든 필수 항목(제목, 내용, 작성자, 비밀번호)을 입력해주세요." });
      }

      const newPost: PostItem = {
        id: `post-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        title: title.trim(),
        content: content.trim(),
        author: author.trim(),
        passwordHash: String(password),
        category: category || "일반",
        createdAt: new Date().toISOString(),
        views: 0,
        likes: 0,
        tags: Array.isArray(tags) ? tags : []
      };

      posts.unshift(newPost);

      res.status(201).json({
        success: true,
        message: "게시글이 성공적으로 등록되었습니다.",
        data: {
          ...newPost,
          commentCount: 0
        }
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "게시글 등록 중 오류가 발생했습니다." });
    }
  });

  // 4. Update a post (with password check)
  app.put("/api/posts/:id", (req, res) => {
    try {
      const { id } = req.params;
      const { title, content, password, category, tags } = req.body;

      const post = posts.find(p => p.id === id);
      if (!post) {
        return res.status(404).json({ success: false, message: "게시글을 찾을 수 없습니다." });
      }

      if (post.passwordHash !== String(password)) {
        return res.status(401).json({ success: false, message: "비밀번호가 일치하지 않습니다." });
      }

      if (title) post.title = title.trim();
      if (content) post.content = content.trim();
      if (category) post.category = category;
      if (tags && Array.isArray(tags)) post.tags = tags;
      post.updatedAt = new Date().toISOString();

      res.json({
        success: true,
        message: "게시글이 수정되었습니다.",
        data: post
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "게시글 수정 중 오류가 발생했습니다." });
    }
  });

  // 5. Delete a post (with password check)
  app.delete("/api/posts/:id", (req, res) => {
    try {
      const { id } = req.params;
      const password = req.body?.password || req.query?.password;

      const postIndex = posts.findIndex(p => p.id === id);
      if (postIndex === -1) {
        return res.status(404).json({ success: false, message: "게시글을 찾을 수 없습니다." });
      }

      if (posts[postIndex].passwordHash !== String(password)) {
        return res.status(401).json({ success: false, message: "비밀번호가 일치하지 않습니다." });
      }

      // Remove post and associated comments
      posts.splice(postIndex, 1);
      for (let i = comments.length - 1; i >= 0; i--) {
        if (comments[i].postId === id) {
          comments.splice(i, 1);
        }
      }

      res.json({ success: true, message: "게시글이 삭제되었습니다." });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "게시글 삭제 중 오류가 발생했습니다." });
    }
  });

  // 6. Like a post
  app.post("/api/posts/:id/like", (req, res) => {
    try {
      const { id } = req.params;
      const post = posts.find(p => p.id === id);
      if (!post) {
        return res.status(404).json({ success: false, message: "게시글을 찾을 수 없습니다." });
      }

      post.likes += 1;
      res.json({ success: true, likes: post.likes });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "오류가 발생했습니다." });
    }
  });

  // 7. Add a comment / reply to a post
  app.post("/api/posts/:id/comments", (req, res) => {
    try {
      const { id } = req.params;
      const { author, password, content, parentId } = req.body;

      const post = posts.find(p => p.id === id);
      if (!post) {
        return res.status(404).json({ success: false, message: "게시글을 찾을 수 없습니다." });
      }

      if (!author || !password || !content) {
        return res.status(400).json({ success: false, message: "작성자, 비밀번호, 댓글 내용을 모두 입력해주세요." });
      }

      const newComment: CommentItem = {
        id: `comment-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        postId: id,
        parentId: parentId || null,
        author: author.trim(),
        passwordHash: String(password),
        content: content.trim(),
        createdAt: new Date().toISOString(),
        likes: 0
      };

      comments.push(newComment);

      const { passwordHash, ...cleanComment } = newComment;

      res.status(201).json({
        success: true,
        message: "댓글이 등록되었습니다.",
        data: cleanComment,
        totalComments: comments.filter(c => c.postId === id).length
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "댓글 등록 중 오류가 발생했습니다." });
    }
  });

  // 8. Delete a comment (with password check)
  app.delete("/api/posts/:id/comments/:commentId", (req, res) => {
    try {
      const { id, commentId } = req.params;
      const password = req.body?.password || req.query?.password;

      const commentIndex = comments.findIndex(c => c.id === commentId && c.postId === id);
      if (commentIndex === -1) {
        return res.status(404).json({ success: false, message: "댓글을 찾을 수 없습니다." });
      }

      if (comments[commentIndex].passwordHash !== String(password)) {
        return res.status(401).json({ success: false, message: "비밀번호가 일치하지 않습니다." });
      }

      // Remove the comment and any child replies
      const childCommentIds = comments
        .filter(c => c.parentId === commentId)
        .map(c => c.id);

      comments.splice(commentIndex, 1);

      // Remove child replies
      for (let i = comments.length - 1; i >= 0; i--) {
        if (childCommentIds.includes(comments[i].id)) {
          comments.splice(i, 1);
        }
      }

      res.json({
        success: true,
        message: "댓글이 삭제되었습니다.",
        totalComments: comments.filter(c => c.postId === id).length
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "댓글 삭제 중 오류가 발생했습니다." });
    }
  });

  // 9. Like a comment
  app.post("/api/posts/:id/comments/:commentId/like", (req, res) => {
    try {
      const { commentId } = req.params;
      const comment = comments.find(c => c.id === commentId);
      if (!comment) {
        return res.status(404).json({ success: false, message: "댓글을 찾을 수 없습니다." });
      }

      comment.likes += 1;
      res.json({ success: true, likes: comment.likes });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "오류가 발생했습니다." });
    }
  });

  // --- VITE / STATIC SERVING ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
