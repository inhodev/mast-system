begin;
alter table public.promotion_rotation_config drop constraint if exists promotion_rotation_config_interval_days_check;
alter table public.promotion_rotation_config alter column interval_days set default 1;
update public.promotion_rotation_config set interval_days=1 where id;
alter table public.promotion_rotation_config add constraint promotion_rotation_config_interval_days_check check(interval_days=1);
notify pgrst,'reload schema';
commit;
