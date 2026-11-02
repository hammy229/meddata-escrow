-- Local synthetic provider fixture. The marketplace login can read only the view.
CREATE TABLE public.synthetic_records (
  dataset_id text NOT NULL,
  age numeric,
  sex text,
  region text,
  age_group text,
  diagnosis text,
  year integer,
  value numeric,
  cost numeric,
  los numeric,
  bmi numeric,
  score numeric
);
INSERT INTO public.synthetic_records
SELECT 'cardio_demo', 30 + n % 50,
       CASE WHEN n % 2 = 0 THEN 'female' ELSE 'male' END,
       CASE WHEN n % 2 = 0 THEN 'midwest' ELSE 'west' END,
       '35-49', 'I10', 2025, 40 + n % 40, 100 + n % 1000,
       1 + n % 10, 20 + n % 10, 50 + n % 30
FROM generate_series(1, 1200) n;
CREATE VIEW public.research_records WITH (security_barrier = true) AS
SELECT dataset_id, age, sex, region, age_group, diagnosis, year, value, cost, los, bmi, score
FROM public.synthetic_records;
CREATE ROLE meddata_reader LOGIN PASSWORD 'local-reader-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT CONNECT ON DATABASE research TO meddata_reader;
GRANT USAGE ON SCHEMA public TO meddata_reader;
GRANT SELECT ON public.research_records TO meddata_reader;
ALTER ROLE meddata_reader SET default_transaction_read_only = on;
ALTER ROLE meddata_reader SET statement_timeout = '8s';
