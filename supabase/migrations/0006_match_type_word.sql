-- Libera o novo tipo de correspondência "word" (palavra isolada) nos gatilhos.
alter table triggers drop constraint if exists triggers_match_type_check;
alter table triggers add constraint triggers_match_type_check
  check (match_type in ('exact', 'contains', 'word', 'any'));
