create table user(
    id text,
    twitter_id text not null,
    twitter_name text not null,
    twitter_icon text not null,
    score integer not null,
    valid boolean not null,
    created_at integer not null,
    updated_at integer not null,
    primary key (id)
);

create table solved(
    id text references user(id),
    problem text not null,
    flag integer not null,
    created_at integer not null,
    primary key(id, problem, flag)
);
