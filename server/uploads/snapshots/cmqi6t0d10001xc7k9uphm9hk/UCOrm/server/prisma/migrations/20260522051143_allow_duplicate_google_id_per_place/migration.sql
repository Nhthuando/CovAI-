-- CreateTable
CREATE TABLE "ai_replies" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "review_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "places" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "google_place_id" TEXT NOT NULL,
    "name" TEXT,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "place_id" TEXT NOT NULL,
    "google_id" TEXT NOT NULL,
    "author_name" TEXT,
    "rating" INTEGER,
    "text" TEXT,
    "published_at" TIMESTAMPTZ(6),
    "status" TEXT DEFAULT 'PENDING',
    "approved_reply_id" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "places_google_place_id_user_id_key" ON "places"("google_place_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_google_id_place_id_key" ON "reviews"("google_id", "place_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- AddForeignKey
ALTER TABLE "ai_replies" ADD CONSTRAINT "ai_replies_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "places" ADD CONSTRAINT "places_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "fk_approved_reply" FOREIGN KEY ("approved_reply_id") REFERENCES "ai_replies"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
