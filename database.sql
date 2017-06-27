create table user(
    id text,
    twitter_id text not null,
    twitter_name text not null,
    twitter_icon text not null,
    icon_index integer,
    score integer not null,
    score_updated real not null,
    created_at real not null,
    updated_at real not null,
    primary key (id)
);

create table problem(
    problem text,
    flag text,
    point int not null,
    primary key(problem, flag)
);

create table solved(
    user text references user(id),
    problem text not null,
    flag text not null,
    created_at real not null,
    primary key(user, problem, flag)
);
